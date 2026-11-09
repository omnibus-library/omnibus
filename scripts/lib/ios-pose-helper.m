//  ios-pose-helper.m — runs inside an iOS simulator (`xcrun simctl spawn`) to
//  fold and rotate a foldable the way Xcode's Device Hub does. Built and run by
//  scripts/ios-pose.sh; nothing else should call it.
//
//  Device Hub's hinge slider and orientation picker each post one
//  vendor-defined HID event (usage page 0xFF61, usage 0x5B) whose payload is an
//  IOCFSerialize'd dictionary; the simulator's locationd turns it into the
//  CoreMotion hinge angle and the device orientation. Private API, found by
//  disassembling Device Hub and locationd (Xcode 27.2); the same approach as
//  github.com/artemnovichkov/hinge. Expect a new Xcode to move it.
//
//    ios-pose-helper hinge <degrees> <confirm-seconds>   0 closed … 180 flat
//    ios-pose-helper orient <portrait|landscape-left|landscape-right|pud>
//    ios-pose-helper angle                               prints the hinge angle

#import <Foundation/Foundation.h>

#include <mach/mach_time.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct __IOHIDEvent *IOHIDEventRef;
typedef struct __IOHIDEventSystemClient *IOHIDEventSystemClientRef;

extern IOHIDEventRef IOHIDEventCreateVendorDefinedEvent(CFAllocatorRef, uint64_t timeStamp, uint32_t usagePage,
    uint32_t usage, uint32_t version, const uint8_t *data, CFIndex length, uint32_t options);
extern IOHIDEventSystemClientRef IOHIDEventSystemClientCreateWithType(CFAllocatorRef, int type, CFDictionaryRef);
extern void IOHIDEventSystemClientDispatchEvent(IOHIDEventSystemClientRef, IOHIDEventRef);
extern CFDataRef IOCFSerialize(CFTypeRef object, CFOptionFlags options);

// CoreMotion's private hinge sensor, the one UIKit reads.
@interface CMAngle : NSObject
- (float)angleDegrees;
- (float)mechanicalAngleDegrees;
@end

@interface CMAngleManager : NSObject
+ (BOOL)isAvailable;
- (void)startAngleUpdatesToQueue:(NSOperationQueue *)queue handler:(void (^)(CMAngle *angle))handler;
- (void)stopAngleUpdates;
@end

static const uint32_t kUsagePage = 0xFF61;
static const uint32_t kUsage = 0x5B;
static const int kClientTypeSimple = 4;
static const CFOptionFlags kSerializeBinary = 1;

static void post(CFStringRef source, CFStringRef type, CFTypeRef value) {
    IOHIDEventSystemClientRef client = IOHIDEventSystemClientCreateWithType(NULL, kClientTypeSimple, NULL);
    if (!client) {
        fprintf(stderr, "ios-pose-helper: no HID event system client\n");
        exit(1);
    }
    // locationd ignores the provider; it is what Device Hub sends.
    NSDictionary *payload = @{
        @"provider" : @"com.apple.Virtualization.VirtualMachines",
        @"source" : (__bridge NSString *)source,
        @"type" : (__bridge NSString *)type,
        @"value" : (__bridge id)value,
    };
    CFDataRef data = IOCFSerialize((__bridge CFTypeRef)payload, kSerializeBinary);
    IOHIDEventRef event = data ? IOHIDEventCreateVendorDefinedEvent(NULL, mach_absolute_time(), kUsagePage, kUsage, 0,
                                                                    CFDataGetBytePtr(data), CFDataGetLength(data), 0)
                               : NULL;
    if (!event) {
        fprintf(stderr, "ios-pose-helper: could not build the HID event\n");
        exit(1);
    }
    IOHIDEventSystemClientDispatchEvent(client, event);
    usleep(20000); // let the event leave before the process exits
    CFRelease(event);
    CFRelease(data);
    CFRelease(client);
}

// The angle the slider asked for. `angleDegrees` can settle a few degrees off
// it on newer runtimes; `mechanicalAngleDegrees` stays exact where it exists.
static double commanded(CMAngle *angle) {
    return [angle respondsToSelector:@selector(mechanicalAngleDegrees)] ? [angle mechanicalAngleDegrees]
                                                                        : [angle angleDegrees];
}

// Streams angle updates until `accept` takes one or `timeout` passes. The
// stream delivers the current angle at once, so `kick` runs after it starts.
static BOOL watch_angle(double timeout, void (^kick)(void), BOOL (^accept)(CMAngle *)) {
    Class managerClass = NSClassFromString(@"CMAngleManager");
    if (!managerClass || ![managerClass isAvailable]) {
        fprintf(stderr, "ios-pose-helper: this simulator has no hinge (not an iPhone Duo?)\n");
        exit(2);
    }
    CMAngleManager *manager = [[managerClass alloc] init];
    __block BOOL done = NO;
    [manager startAngleUpdatesToQueue:[NSOperationQueue new]
                              handler:^(CMAngle *angle) {
                                  if (!done && accept(angle)) done = YES;
                              }];
    if (kick) kick();
    CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + timeout;
    while (!done && CFAbsoluteTimeGetCurrent() < deadline) {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, false);
    }
    [manager stopAngleUpdates];
    return done;
}

static int set_hinge(double degrees, double timeout) {
    NSNumber *value = @(degrees);
    BOOL reached = watch_angle(
        timeout,
        ^{
            post(CFSTR("hinge-slider-control"), CFSTR("range"), (__bridge CFTypeRef)value);
        },
        ^BOOL(CMAngle *angle) {
            return fabs(commanded(angle) - degrees) <= 0.5;
        });
    if (!reached) fprintf(stderr, "ios-pose-helper: the hinge did not reach %.1f° within %.1fs\n", degrees, timeout);
    return reached ? 0 : 1;
}

static int print_angle(void) {
    __block double current = 0;
    BOOL read = watch_angle(2, nil, ^BOOL(CMAngle *angle) {
        current = [angle angleDegrees];
        return YES;
    });
    if (!read) {
        fprintf(stderr, "ios-pose-helper: no hinge reading within 2s\n");
        return 1;
    }
    printf("%.1f\n", current);
    return 0;
}

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc == 2 && strcmp(argv[1], "angle") == 0) return print_angle();
        if (argc == 4 && strcmp(argv[1], "hinge") == 0) return set_hinge(atof(argv[2]), atof(argv[3]));
        if (argc == 3 && strcmp(argv[1], "orient") == 0) {
            post(CFSTR("orientation-picker-control"), CFSTR("enum"),
                 (__bridge CFTypeRef)[NSString stringWithUTF8String:argv[2]]);
            return 0;
        }
        fprintf(stderr, "usage: ios-pose-helper hinge <degrees> <confirm-seconds> | orient <name> | angle\n");
        return 64;
    }
}

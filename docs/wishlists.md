# Wishlists

> What are they, what do they do, how do I use them, and other questions from the universe.

## Example Scenario

1. You walk into a book store
2. You think a book is interesting, but you're not sold on buying it that second
3. You open the Omnibus mobile app
4. You scan the ISBN barcode on the back of the book
5. You add it to your wishlist

Now you can view your wishlist in Omnibus to see your wishlisted books. Omnibus's wishlist allows you to
find a copy of the physical book for your real shelves OR to request a digital form(s) of that media through
your own indexers.

## Wishlist vs Request

They sound alike, but one is a bookmark and the other is a job.

- A **wish** is a lasting intent: "I want this book in print." It belongs to one user, stays on their
  wishlist for as long as they like, and clears once a physical copy is checked in.
- A **request** is a job that fetches one digital format (ebook or audiobook) of one book through your
  indexers, even a format the book already has. It moves through the states below. A request can start
  from a wish or straight from a book's details.

You wouldn't "Request" a physical book unless you're a very demanding person. You'd simply add it to your
wishlist and hope that someone gets it for you out of the kindness of their heart.

## Request States

Omnibus uses its own words for a request, never the downloader's ("release", "indexer", "grab", "seeds"). The
one exception is a version row's seed count ("142 seeds"), which says how likely a version is to finish.

1. **Looking**: Omnibus is searching for versions of the book. A new request starts here.
2. **Choose a version**: versions were found and the user picks one. This is the only state that needs the user.
   Once picked, the request shows as "Version chosen" until the download slice turns it into **On its way**.
3. **On its way**: the chosen version is downloading and being added to the library, shown as one progress bar.
4. **Ready**: the format is in the library ("Ready to read" or "Ready to listen"). When the download's cover has more
   pixels than the book's own, the requester or an admin is offered it ("Use the downloaded cover" or "Keep this one").

Two states can end a request early:

- **Stuck**: something went wrong, with a plain reason ("Couldn't find it", "Stopped moving", "Couldn't add it")
  and a "Try again" button.
- **Cancelled**: the user cancelled it (see S7).

A found result is a **version**, never a "copy": "copy" already means a physical book in Omnibus. A version row shows
its name, then where it came from, its format, size and seeds ("MyAnonamouse · EPUB · 1.8 MB · 142 seeds", or "Usenet"
for a source with none), then whether it's the best match or didn't work. The best match and the next three show
first, with "Show more" for the rest. Usenet versions are left out
until Omnibus has a Usenet download client.

Requesting from the wishlist asks one question (ebook or audiobook), starts the request, and takes the user
straight to that book on the Requests page, already in "Looking".

A request can also start from the Requests page's search ("+ Request"): it finds a library book or a provider's record of one the library lacks, and starts an ebook request without making a wishlist entry.

## Objectives

1. The ability to track physical copies of your own books
   - Omnibus allows you to track your digital library AND your physical library so you know the books you have
     anywhere you go.
2. The ability to scan a book and place it into your wishlist
   - When scanning isn't available, the user should be able to search for it (i.e. web)
   - After a successful scan, the user can follow multiple options including: "Add to wishlist", "Check in physical book", "Start request"
3. The ability to request a book on your wishlist through your indexers
   - Your wishlist shows all the books you're interested in.
   - Starting a request for a book will start the sequence of finding that book through your indexers

# Scenarios

## S1. Scanned book in Barnes & Noble

1. User scans Dracula in Barnes & Noble
2. User adds Dracula to their wishlist
3. User goes to their wishlist & starts a request for Dracula's EPUB
4. Omnibus reaches out to Shelfarr and returns search results for the EPUB
5. User selects a search result to start the download
6. Shelfarr starts the download and informs Omnibus when complete
7. Omnibus does a quick scan of the library to populate the book
8. User can see the Dracula book in their library

End result: Dracula is now a piece of digital media that the user can add to shelves, read, journal, and review.

## S2. Searched Book on Web

1. User searches for "Dracula"
2. Omnibus returns no results in Omnibus, but finds the book from other metadata sources
3. Omnibus offers a "Add to Wishlist" button on the book
4. User adds the book to their wishlist
5. User goes to their wishlist & starts a request for Dracula
6. Omnibus reaches out to Shelfarr and returns search results for the EPUB
7. User selects a search result to start the download
8. Shelfarr starts the download and informs Omnibus when complete
9. Omnibus does a quick scan of the library to populate the book
10. User can see the Dracula book in their library

End result: Dracula is now a piece of digital media that the user can add to shelves, read, journal, and review.

## S3. EPUB Exists, Requesting Audiobook

1. User is reading Dracula but would like the audiobook format as well
2. User clicks on a "Request" button below the audiobook section in the files tab of book details for Dracula
3. Omnibus starts a request through Shelfarr
4. Shelfarr returns search results to Omnibus
5. User selects a search result from Omnibus to start downloading
6. Download starts & completes
7. Omnibus does a quick scan of the library to populate the book
8. User can see the Dracula audiobook in their library

End result: Dracula's audiobook now exists in the library, is merged with the ebook, and user can now immersive read Dracula

## S4. Downloaded Copy is Incorrect

1. User acquires an ebook in their library that is the wrong version
2. User clicks on a "Request" button below the EPUB in the Files & Details section of book details
3. Omnibus starts a request through Shelfarr
4. Shelfarr returns search results to Omnibus
5. User selects a search result from Omnibus to start downloading through Shelfarr
6. Shelfarr starts & completes the download
7. Omnibus does a quick scan of the library to populate the book & merges with previous book
8. User can now select the epub via dropdown in book details
9. (Optional) User can delete the old, invalid book from Files & Details in Book Details

End result: Old incorrect book remains on Omnibus (unless deleted in Step 9) and new, correct version is downloaded & populated

## S5. Wishlist Book is Acquired

1. User adds Dracula to their wishlist
2. User gets the EPUB via Omnibus or other source
   - Book remains in the wishlist since no physical book was checked in
3. User gets the Audiobook via Omnibus or other source
   - Book remains in the wishlist since no physical book was checked in
4. User buys the physical copy and scans it into Omnibus
   - Book is removed from the wishlist automatically

End result: Books are only removed from the wishlist when they are physical books added

## S6. Wishlist book is deleted

1. User adds Dracula to their wishlist
2. User requests the EPUB for Dracula
3. User deletes the Dracula book from their wishlist
4. User/Admin can still see the Dracula book from the request via the requests page

End result: Wishlist books can be removed easily from the wishlist, but requests that are made are stored in the database

## S7. Download is Cancelled

1. User adds Dracula to their wishlist
2. User requests the EPUB for Dracula and picks a release
3. The download starts
4. User selects Dracula on the requests page and clicks "Cancel" beside its download
   - The request shows as cancelled right away, with an "Undo" toast
   - Omnibus waits until the toast closes before telling the requester to stop, so "Undo" just keeps the download going
5. The requester stops the download and deletes the partial file
   - Nothing half-downloaded ever lands in the library folder
6. The request moves to the book's request history as "Cancelled", with a "Request again" button once the
   "Undo" has run out and while the user has no other request going for it
7. Dracula stays on the user's wishlist, and its EPUB slot goes back to "Not requested"

End result: The download is stopped and cleaned up, the cancelled request stays in history, and the wish is untouched

Notes:

- "Choose another" is not a cancel: it stops this download and goes back to the versions found, but the request stays alive
- History only records what Omnibus knows: who cancelled, when, which version and how far it got (e.g. "Cancelled by
  you · EPUB · 2.4 MB · stopped at 40%"). It never guesses a reason; choosing another version records "Swapped for
  another version" instead
- Cancel is no longer offered once the import has started
- Only the user who made the request (or an admin) can cancel it

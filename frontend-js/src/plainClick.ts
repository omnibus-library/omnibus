/** A bare primary-button click, which a link follows in place; a modified one opens elsewhere and must not also run the link's side effect. */
export const isPlainClick = (e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) => e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);

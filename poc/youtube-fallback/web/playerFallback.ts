/** YouTube source failures that must be reported to the server authority. */
export function isRuntimeSourceFailure(errorCode: number): errorCode is 100 | 101 | 150 {
  return errorCode === 100 || errorCode === 101 || errorCode === 150;
}

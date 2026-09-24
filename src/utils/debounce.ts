/** A debounced function that can also drop a still-pending call. */
export interface DebouncedFunction<T extends (...args: any[]) => void> {
  (...args: Parameters<T>): void;
  /** Cancels the scheduled call — use on unmount, or when a modal closes. */
  cancel: () => void;
}

// Debounce utility function
export const debounce = <T extends (...args: any[]) => void>(
  func: T,
  delay: number
): DebouncedFunction<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const debounced = (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };

  // Without this, a pending search still fires after the owner goes away,
  // calling setState on an unmounted component and repopulating a closed
  // dropdown with results the user never asked for.
  debounced.cancel = () => clearTimeout(timeoutId);

  return debounced;
};
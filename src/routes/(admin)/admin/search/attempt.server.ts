/** Runs f so that a synchronous throw lands in the same catch as a rejection. */
export const attempt = <T>(f: () => Promise<T>): Promise<T> => Promise.resolve().then(f);

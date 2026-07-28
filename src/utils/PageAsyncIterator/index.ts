type PageAsyncIteratorOptions<T = any> = [
  (lastData: T | null) => Promise<T>,
  (res: T) => boolean,
]

export async function* createPageAsyncIterator<T = any>(
  generator: () => PageAsyncIteratorOptions<T>,
): AsyncGenerator<T, void, undefined> {
  const [request, testHasNext] = generator();
  let hasNext = true;
  let lastData: T | null = null;
  while (hasNext) {
    const res = await request(lastData);
    lastData = res;
    hasNext = testHasNext(res);
    yield lastData;
  }
}
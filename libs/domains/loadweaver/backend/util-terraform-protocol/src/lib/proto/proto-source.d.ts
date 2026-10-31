/** `.proto` files are bundled as their source text (webpack `asset/source`, a jest transform in tests). */
declare module '*.proto' {
  const source: string;
  export default source;
}

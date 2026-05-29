export async function f(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

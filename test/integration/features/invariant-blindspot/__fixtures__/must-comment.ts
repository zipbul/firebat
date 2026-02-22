// You must call init() before using this module
export let initialized = false;

export function init(): void {
  initialized = true;
}

export function doWork(): void {
  // always check initialized before proceeding
}

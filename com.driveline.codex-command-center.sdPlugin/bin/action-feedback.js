export async function runWithFeedback(target, operation, logger) {
  try {
    const result = await operation();
    if (target.isKey()) await target.showOk();
    return result;
  } catch (error) {
    logger?.error?.(error?.stack || String(error));
    await target.showAlert();
    throw error;
  }
}

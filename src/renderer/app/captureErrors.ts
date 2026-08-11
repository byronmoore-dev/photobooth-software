export const captureErrorMessage = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

export const isRecoverableFlashError = (reason: unknown) => {
  const message = captureErrorMessage(reason);
  return (
    message.includes('The Canon flash did not fire.') ||
    message.includes('The Canon photo did not include flash confirmation.')
  );
};

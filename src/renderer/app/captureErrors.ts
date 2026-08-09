export const captureErrorMessage = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

export const isRecoverableFlashError = (reason: unknown) => {
  const message = captureErrorMessage(reason);
  return (
    message.startsWith('The Canon flash did not fire.') ||
    message.startsWith('The Canon photo did not include flash confirmation.')
  );
};

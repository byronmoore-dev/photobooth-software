const nonTypingInputTypes = new Set([
  'button',
  'checkbox',
  'color',
  'date',
  'datetime-local',
  'file',
  'hidden',
  'image',
  'month',
  'radio',
  'range',
  'reset',
  'submit',
  'time',
  'week',
]);

export interface EditableControl {
  tagName: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
  contentEditable?: boolean;
}

export const acceptsTouchKeyboard = (control: EditableControl) => {
  if (control.disabled || control.readOnly) return false;
  const tagName = control.tagName.toLowerCase();
  if (tagName === 'textarea' || control.contentEditable) return true;
  return tagName === 'input' && !nonTypingInputTypes.has((control.type ?? 'text').toLowerCase());
};

export const findTouchKeyboardTarget = (path: EventTarget[]) =>
  path.find((item): item is HTMLElement => {
    if (!(item instanceof HTMLElement)) return false;
    if (item instanceof HTMLInputElement) {
      return acceptsTouchKeyboard({
        tagName: item.tagName,
        type: item.type,
        disabled: item.disabled,
        readOnly: item.readOnly,
      });
    }
    if (item instanceof HTMLTextAreaElement) {
      return acceptsTouchKeyboard({
        tagName: item.tagName,
        disabled: item.disabled,
        readOnly: item.readOnly,
      });
    }
    return acceptsTouchKeyboard({ tagName: item.tagName, contentEditable: item.isContentEditable });
  });

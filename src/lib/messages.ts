export type MessageList = {
  kind: 'message-list';
  items: readonly string[];
  separator: string;
};
export type MessageValue = string | MessageList;
export const messageList = (items: readonly string[], separator = ' '): MessageList => ({
  kind: 'message-list',
  items: [...items],
  separator,
});
export function isMessageList(value: unknown): value is MessageList {
  return (
    !!value &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'message-list' &&
    'items' in value &&
    Array.isArray(value.items) &&
    value.items.every((item) => typeof item === 'string') &&
    'separator' in value &&
    typeof value.separator === 'string'
  );
}
export function formatMessage(
  message: string,
  values: readonly unknown[],
  render: (value: unknown) => string = (value) =>
    isMessageList(value) ? value.items.join(value.separator) : String(value),
) {
  return message.replace(/\{(\d+)\}/g, (placeholder, index) =>
    Number(index) < values.length ? render(values[index]) : placeholder,
  );
}

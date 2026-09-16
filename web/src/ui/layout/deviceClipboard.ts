export type DeviceClipboardContent = {
  plainText: string;
  markdown: string;
};

function singleLine(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/g, " ");
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/[\\`*_{}()#+.!<>|]/g, "\\$&")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

export function formatDeviceClipboardContent({
  deviceName,
  deviceId,
  connection,
}: {
  deviceName: string;
  deviceId: string;
  connection: string;
}): DeviceClipboardContent {
  const name = singleLine(deviceName);
  const id = singleLine(deviceId.trim().toLowerCase());
  const transport = singleLine(connection);
  return {
    plainText: `Device name: ${name}, Device ID: ${id}, Connection: ${transport}`,
    markdown: `**Device name:** ${escapeMarkdown(name)}, **Device ID:** \`${id}\`, **Connection:** ${escapeMarkdown(transport)}`,
  };
}

export async function writeDeviceClipboard(
  content: DeviceClipboardContent,
): Promise<void> {
  const clipboard = navigator.clipboard;
  const clipboardItem = globalThis.ClipboardItem;
  const supportsMarkdown =
    typeof clipboardItem?.supports === "function"
      ? clipboardItem.supports("text/markdown")
      : true;

  if (
    clipboard &&
    typeof clipboard.write === "function" &&
    clipboardItem &&
    supportsMarkdown
  ) {
    const item = new clipboardItem({
      "text/plain": new Blob([content.plainText], { type: "text/plain" }),
      "text/markdown": new Blob([content.markdown], {
        type: "text/markdown",
      }),
    });
    await clipboard.write([item]);
    return;
  }

  await clipboard.writeText(content.plainText);
}

type SelectionSummaryItem = {
  label: string;
  value: string;
  mono?: boolean;
};

export function FirmwareFlashSelectionSummary({
  items,
}: {
  items: SelectionSummaryItem[];
}) {
  return (
    <div
      className="mt-4 border-t border-[var(--border)] pt-3"
      data-testid="firmware-flash-selection-summary"
    >
      <div className="text-[14px] font-bold">Current selection</div>
      <div className="mt-2.5 grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px] font-semibold leading-5">
        {items.map((item) => (
          <SelectionSummaryRow key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
}

function SelectionSummaryRow({
  label,
  value,
  mono = false,
}: SelectionSummaryItem) {
  return (
    <>
      <div className="font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </div>
      <div
        className={[
          "min-w-0 truncate font-bold text-[var(--text)]",
          mono ? "font-mono" : "",
        ].join(" ")}
        title={value}
      >
        {value}
      </div>
    </>
  );
}

import { createContext, useContext, useMemo, useState } from "react";
import type { AddDeviceInput } from "../domain/devices";
import { AddDeviceDialog } from "../ui/dialogs/AddDeviceDialog";

type AddDeviceUiContextValue = {
  openAddDevice: () => void;
};

const AddDeviceUiContext = createContext<AddDeviceUiContextValue | null>(null);

export function AddDeviceUiProvider({
  existingDeviceIds,
  existingDeviceBaseUrls,
  onCreate,
  children,
}: {
  existingDeviceIds: string[];
  existingDeviceBaseUrls: string[];
  onCreate: (input: AddDeviceInput) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const value = useMemo<AddDeviceUiContextValue>(
    () => ({
      openAddDevice: () => setOpen(true),
    }),
    [],
  );

  return (
    <AddDeviceUiContext.Provider value={value}>
      {children}
      <AddDeviceDialog
        open={open}
        existingDeviceIds={existingDeviceIds}
        existingDeviceBaseUrls={existingDeviceBaseUrls}
        onClose={() => setOpen(false)}
        onCreate={onCreate}
      />
    </AddDeviceUiContext.Provider>
  );
}

export function useAddDeviceUi(): AddDeviceUiContextValue {
  const ctx = useContext(AddDeviceUiContext);
  if (!ctx) {
    throw new Error("useAddDeviceUi must be used within <AddDeviceUiProvider>");
  }
  return ctx;
}

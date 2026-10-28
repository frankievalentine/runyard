import { Menu } from "@base-ui/react/menu";
import { setTheme, useTheme, type Theme } from "../lib/theme.ts";

const options: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeMenu() {
  const theme = useTheme();
  return (
    <Menu.Root>
      <Menu.Trigger className="h-7 rounded-[6px] px-2 text-[12px] text-ink-2 hover:bg-hover data-[popup-open]:bg-selected">
        Theme: {options.find((o) => o.value === theme)?.label}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="start">
          <Menu.Popup className="panel min-w-32 p-1 text-[13px] outline-none">
            <Menu.RadioGroup value={theme} onValueChange={(value: Theme) => setTheme(value)}>
              {options.map((o) => (
                <Menu.RadioItem
                  key={o.value}
                  value={o.value}
                  className="flex h-7 items-center gap-2 rounded-[4px] px-2 outline-none data-[highlighted]:bg-selected"
                >
                  <span className="w-3 text-accent">
                    <Menu.RadioItemIndicator>•</Menu.RadioItemIndicator>
                  </span>
                  {o.label}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

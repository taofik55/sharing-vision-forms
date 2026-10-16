"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

/** Lists longer than this get a search box (short lists stay one click). */
export const COMBOBOX_SEARCH_THRESHOLD = 7;

type ComboboxProps = {
  options: ComboboxOption[];
  value: string | undefined;
  onChange: (value: string) => void;
  /** Shown on the trigger when nothing is selected. */
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
  /** Force the search box on / off (default: more than 7 options). */
  searchable?: boolean;
  className?: string;
  contentClassName?: string;
  "data-testid"?: string;
};

/**
 * Dropdown with type-to-search (cmdk in a popover). Keyboard: Enter / Space /
 * ArrowDown opens it, typing filters, arrows move, Enter picks, Esc closes.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  searchable,
  className,
  contentClassName,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const withSearch = searchable ?? options.length > COMBOBOX_SEARCH_THRESHOLD;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          id={aria.id}
          aria-label={aria["aria-label"]}
          aria-describedby={aria["aria-describedby"]}
          aria-invalid={aria["aria-invalid"] || undefined}
          data-testid={aria["data-testid"]}
          className={cn(
            "w-full justify-between font-normal aria-invalid:border-destructive",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected?.icon}
            <span className="truncate">{selected?.label ?? placeholder}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-(--radix-popover-trigger-width) min-w-48 p-0",
          contentClassName,
        )}
      >
        {/* Plain "contains" match on the label: the default fuzzy match
            would also hit the hidden option ids. */}
        <Command
          filter={(_value, search, keywords) =>
            (keywords ?? [])
              .join(" ")
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase())
              ? 1
              : 0
          }
        >
          {withSearch && <CommandInput placeholder={searchPlaceholder} />}
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  // Unique value (the id); people search the label (keywords).
                  value={o.value}
                  keywords={[o.label]}
                  disabled={o.disabled}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.icon}
                  <span className="min-w-0 flex-1 break-words">{o.label}</span>
                  <Check
                    className={cn(
                      "ml-auto size-4",
                      o.value === value ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

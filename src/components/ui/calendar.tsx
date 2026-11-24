
"use client"

import * as React from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <>
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("relative p-3 w-full", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4 w-full",
        month_caption: "flex justify-center h-9 px-8 relative items-center",
        caption_label: "text-sm font-medium",
        dropdowns: "flex justify-center gap-1",
        nav: "absolute inset-x-3 top-3 z-10 flex items-center justify-between pointer-events-none",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "pointer-events-auto h-9 w-9 bg-transparent p-0"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "pointer-events-auto h-9 w-9 bg-transparent p-0"
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday:
          "text-muted-foreground rounded-md w-full font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: "h-9 w-full text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-full p-0 font-normal aria-selected:opacity-100"
        ),
        range_end: "day-range-end",
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        today: "bg-accent text-accent-foreground",
        outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground",
        disabled: "text-muted-foreground opacity-50",
        range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => orientation === "left"
          ? <ChevronLeft className="h-4 w-4" />
          : orientation === "right"
            ? <ChevronRight className="h-4 w-4" />
            : <ChevronDown className="h-4 w-4" />,
        Dropdown: ({ value, onChange, options = [], "aria-label": label }) => {
          const selectValue = String(value)
          const handleValueChange = (newValue: string) => {
            const event = {
              target: { value: newValue },
            } as React.ChangeEvent<HTMLSelectElement>
            if (onChange) {
               onChange(event)
            }
          }

          return (
            <Select onValueChange={handleValueChange} value={selectValue}>
              <SelectTrigger aria-label={label} className="w-fit pr-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <ScrollArea className="h-80">
                  {options.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={String(option.value)}
                      disabled={option.disabled}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </ScrollArea>
              </SelectContent>
            </Select>
          )
        },
      }}
      {...props}
    />
    </>
  )
}
Calendar.displayName = "Calendar"

export { Calendar }

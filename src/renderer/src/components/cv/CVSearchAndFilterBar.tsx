import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface CVSearchAndFilterBarProps {
  search: string;
  setSearch: (s: string) => void;
  tag: string;
  setTag: (t: string) => void;
  status: string;
  setStatus: (s: string) => void;
  jobType: string;
  setJobType: (j: string) => void;
  dateRange: DateRange | undefined;
  setDateRange: (d: DateRange | undefined) => void;
  onExportCsv?: () => void;
}

export function CVSearchAndFilterBar({
  search,
  setSearch,
  tag,
  setTag,
  status,
  setStatus,
  jobType,
  setJobType,
  dateRange,
  setDateRange,
  onExportCsv,
}: CVSearchAndFilterBarProps) {
  const [customTags, setCustomTags] = useState<any[]>([]);

  useEffect(() => {
    loadTags();
  }, []);

  const loadTags = async () => {
    const res = await window.api.getCustomTags();
    if (res.success) {
      setCustomTags(res.data || []);
    }
  };

  const skills = customTags.filter((t) => t.category === "Skill");
  const statuses = customTags.filter((t) => t.category === "Status");
  const jobTypes = customTags.filter((t) => t.category === "JobType");

  return (
    <div className="flex flex-col gap-4 mb-6">
      <div className="flex gap-2 w-full">
        <Input
          type="text"
          placeholder="Search candidates, skills, or CV contents..."
          className="flex-1 min-w-50"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {onExportCsv && (
          <Button
            onClick={onExportCsv}
            variant="outline"
            className="gap-2 shrink-0"
          >
            <Download className="size-4" /> Export CSV
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger className="w-45">
            <SelectValue placeholder="Tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tags</SelectItem>
            {skills.map((skill) => (
              <SelectItem key={skill.id} value={skill.name}>
                {skill.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-45">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Pending Review">Pending Review</SelectItem>
            <SelectItem value="Interviewing">Interviewing</SelectItem>
            <SelectItem value="Rejected">Rejected</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s.id} value={s.name}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={jobType} onValueChange={setJobType}>
          <SelectTrigger className="w-45">
            <SelectValue placeholder="Job Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Job Types</SelectItem>
            {jobTypes.map((jt) => (
              <SelectItem key={jt.id} value={jt.name}>
                {jt.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              id="date"
              variant={"outline"}
              className={cn(
                "w-65 justify-start text-left font-normal",
                !dateRange && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 size-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "LLL dd, y")} -{" "}
                    {format(dateRange.to, "LLL dd, y")}
                  </>
                ) : (
                  format(dateRange.from, "LLL dd, y")
                )
              ) : (
                <span>Date Added</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        {/* Dropdown menu removed, Export CSV is now a primary action button next to the search bar */}
      </div>
    </div>
  );
}

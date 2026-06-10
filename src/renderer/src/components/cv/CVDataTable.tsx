import { useEffect, useRef, useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  ColumnFiltersState,
  VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Trash2, ArrowUpDown, ChevronDown } from "lucide-react";

interface CVDataTableProps {
  search: string;
  tag: string;
  status: string;
  jobType?: string;
  dateRange?: DateRange;
  onView: (id: number) => void;
  highlightedCandidateId?: number | null;
  clearHighlight?: () => void;
}

// Custom Editable Cell Component
function EditableCell({ getValue, row, column, table }: any) {
  const initialValue = getValue();
  const [value, setValue] = useState(initialValue);
  const [isEditing, setIsEditing] = useState(false);

  const onBlur = () => {
    setIsEditing(false);
    if (value !== initialValue) {
      table.options.meta?.updateData(row.original.id, column.id, value);
    }
  };

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  if (!isEditing) {
    return (
      <div
        className="truncate cursor-text px-2 py-1 min-h-[28px] hover:bg-muted/50 rounded"
        onClick={() => setIsEditing(true)}
        title={value || ""}
      >
        {value || (
          <span className="text-muted-foreground/50 italic">Empty</span>
        )}
      </div>
    );
  }

  return (
    <Input
      autoFocus
      value={value || ""}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => e.key === "Enter" && onBlur()}
      className="h-7 text-sm px-2 py-1"
    />
  );
}

function StatusCell({ getValue, row, column, table }: any) {
  const value = getValue() as string;

  return (
    <Select
      value={value || ""}
      onValueChange={(val) =>
        table.options.meta?.updateData(row.original.id, column.id, val)
      }
    >
      <SelectTrigger className="h-7 text-xs border-none bg-transparent hover:bg-muted/50 w-[130px]">
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="Pending Review">Pending Review</SelectItem>
        <SelectItem value="Interviewing">Interviewing</SelectItem>
        <SelectItem value="Offered">Offered</SelectItem>
        <SelectItem value="Rejected">Rejected</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function CVDataTable({
  search,
  tag,
  status,
  jobType,
  dateRange,
  onView,
  highlightedCandidateId,
  clearHighlight,
}: CVDataTableProps) {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [isFetching, setIsFetching] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const [candidateToDelete, setCandidateToDelete] = useState<number | null>(
    null,
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);

  const fetchCandidates = async (offset: number, reset: boolean = false) => {
    setIsFetching(true);
    try {
      // Map global search/tag/status + Tanstack column filters
      const combinedFilters = [...columnFilters];
      if (status && status !== "all")
        combinedFilters.push({ id: "status", value: status });
      if (tag && tag !== "all")
        combinedFilters.push({ id: "tags", value: tag });
      if (jobType && jobType !== "all")
        combinedFilters.push({ id: "job_type", value: jobType });

      if (dateRange?.from) {
        combinedFilters.push({
          id: "created_at_start",
          value: format(dateRange.from, "yyyy-MM-dd"),
        });
      }
      if (dateRange?.to) {
        combinedFilters.push({
          id: "created_at_end",
          value: format(dateRange.to, "yyyy-MM-dd"),
        });
      }

      const sortingParam = sorting.map((s) => ({ id: s.id, desc: s.desc }));

      const res = await window.api.getCandidates({
        search,
        filters: combinedFilters,
        sorting: sortingParam,
        offset,
        limit: 50,
      });
      if (res.success) {
        setCandidates((prev) =>
          reset ? res.data || [] : [...prev, ...(res.data || [])],
        );
        setTotal(res.total || 0);
      }
    } finally {
      setIsFetching(false);
    }
  };

  // Reload completely on filter changes
  useEffect(() => {
    fetchCandidates(0, true);
  }, [search, tag, status, jobType, dateRange, sorting, columnFilters]);

  const handleDelete = async (id: number) => {
    const res = await window.api.deleteCandidate(id);
    if (res.success) {
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      setTotal((t) => t - 1);
    }
    setCandidateToDelete(null);
  };

  const columns = useMemo<ColumnDef<any>[]>(
    () => [
      {
        accessorKey: "first_name",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting()}
            className="-ml-3 h-8 data-[state=open]:bg-accent"
          >
            First Name <ArrowUpDown className="ml-2 size-3" />
          </Button>
        ),
        cell: EditableCell,
        size: 150,
      },
      {
        accessorKey: "last_name",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting()}
            className="-ml-3 h-8"
          >
            Last Name <ArrowUpDown className="ml-2 size-3" />
          </Button>
        ),
        cell: EditableCell,
        size: 150,
      },
      {
        accessorKey: "headline",
        header: "Headline",
        cell: EditableCell,
        size: 300,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: StatusCell,
        size: 140,
      },
      {
        accessorKey: "tags",
        header: "Skills",
        cell: ({ getValue }) => {
          const val = getValue() as string;
          let tags: string[] = [];
          try {
            tags = JSON.parse(val || "[]");
          } catch {}
          return (
            <div className="flex gap-1 flex-wrap overflow-hidden max-h-6">
              {tags.slice(0, 2).map((t: string) => (
                <Badge key={t} variant="outline" className="text-[10px] h-5">
                  {t}
                </Badge>
              ))}
              {tags.length > 2 && (
                <span className="text-xs text-muted-foreground">
                  +{tags.length - 2}
                </span>
              )}
            </div>
          );
        },
        size: 180,
      },
      {
        accessorKey: "job_type",
        header: "Job Type",
        cell: EditableCell,
        size: 140,
      },
      {
        accessorKey: "created_at",
        header: "Date Added",
        cell: ({ getValue }) => {
          const val = getValue() as string;
          return val ? new Date(val).toLocaleDateString() : "";
        },
        size: 100,
      },
      {
        accessorKey: "updated_at",
        header: "Date Modified",
        cell: ({ getValue }) => {
          const val = getValue() as string;
          return val ? new Date(val).toLocaleDateString() : "";
        },
        size: 100,
      },
      {
        id: "actions",
        header: "Actions",
        // size: 100,
        cell: ({ row }) => (
          <div className="flex justify-end items-center gap-2">
            <Button
              variant="link"
              size="sm"
              className="h-8"
              onClick={() => onView(row.original.id)}
            >
              View
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setCandidateToDelete(row.original.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ),
      },
    ],
    [onView],
  );

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    job_type: false,
    created_at: false,
    updated_at: false,
  });

  const table = useReactTable({
    data: candidates,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
    columnResizeMode: "onChange",
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      updateData: async (id: number, columnId: string, value: any) => {
        // Optimistic update
        setCandidates((old) =>
          old.map((row) => {
            if (row.id === id) {
              return { ...row, [columnId]: value };
            }
            return row;
          }),
        );
        // Persist to DB
        await window.api.updateCandidate(id, { [columnId]: value });
      },
    },
  });

  // React Virtualizer setup
  const { rows } = table.getRowModel();
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 5,
  });

  const items = rowVirtualizer.getVirtualItems();
  const lastItem = items[items.length - 1];

  useEffect(() => {
    if (!lastItem || isFetching) return;
    if (lastItem.index >= rows.length - 1 && candidates.length < total) {
      fetchCandidates(candidates.length);
    }
  }, [lastItem, rows.length, total, isFetching]);

  useEffect(() => {
    if (highlightedCandidateId) {
      setSelectedRowId(highlightedCandidateId);
      const index = candidates.findIndex(
        (c) => c.id === highlightedCandidateId,
      );
      if (index !== -1) {
        rowVirtualizer.scrollToIndex(index, { align: "center" });
      }
      if (clearHighlight) clearHighlight();
    }
  }, [highlightedCandidateId, candidates, rowVirtualizer, clearHighlight]);

  return (
    <div className="flex flex-col h-full w-full gap-2">
      <div className="flex justify-end shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto">
              Columns <ChevronDown className="ml-2 size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {column.id.replace("_", " ")}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        ref={parentRef}
        className="flex-1 overflow-auto border border-border rounded-lg bg-card relative"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize() + 40}px`, // 40px for header
            width: table.getTotalSize(),
            position: "relative",
          }}
        >
          {/* Table Header (Sticky) */}
          <div className="sticky top-0 z-10 bg-muted/95 backdrop-blur border-b border-border text-sm font-medium text-muted-foreground shadow-sm flex w-full">
            {table.getFlatHeaders().map((header) => (
              <div
                key={header.id}
                style={{ width: header.getSize() }}
                className="relative px-3 py-2 flex items-center shrink-0 border-r border-border/50 last:border-0"
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                {/* Resizer Handle */}
                {header.column.getCanResize() && (
                  <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none hover:bg-primary transition-colors ${
                      header.column.getIsResizing() ? "bg-primary" : ""
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Virtual Rows */}
          {items.map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={row.id}
                onClick={() => setSelectedRowId(row.original.id)}
                onDoubleClick={() => onView(row.original.id)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start + 55}px)`,
                }}
                className={`flex items-center border-b border-border/50 hover:bg-muted/30 text-sm transition-colors cursor-pointer ${
                  selectedRowId === row.original.id
                    ? "bg-primary/10 hover:bg-primary/20"
                    : ""
                }`}
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    style={{ width: cell.column.getSize() }}
                    className="px-3 shrink-0"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}

          {candidates.length === 0 && !isFetching && (
            <div className="absolute top-20 w-full text-center text-muted-foreground p-8">
              No candidates found matching the filters.
            </div>
          )}
        </div>

        <AlertDialog
          open={candidateToDelete !== null}
          onOpenChange={(open) => !open && setCandidateToDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Are you sure you want to delete this candidate?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the
                candidate's data and remove them from our servers.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (candidateToDelete) handleDelete(candidateToDelete);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete Candidate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

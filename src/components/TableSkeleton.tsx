import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

export const TableSkeleton = ({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) => (
  <>
    {Array.from({ length: rows }).map((_, r) => (
      <TableRow key={r}>
        {Array.from({ length: cols }).map((_, c) => (
          <TableCell key={c}><Skeleton className="h-4 w-full" /></TableCell>
        ))}
      </TableRow>
    ))}
  </>
);

export default TableSkeleton;

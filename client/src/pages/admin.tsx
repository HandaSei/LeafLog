import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, ArrowUpDown } from "lucide-react";
import { format } from "date-fns";

interface AccountRow {
  id: number;
  username: string;
  agencyName: string | null;
  email: string | null;
  role: string;
  createdAt: string | null;
}

type SortField = "username" | "createdAt";

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("username");
  const [sortAsc, setSortAsc] = useState(true);

  const { data: accounts, isLoading } = useQuery<AccountRow[]>({
    queryKey: ["/api/admin/accounts"],
  });

  const filtered = useMemo(() => {
    if (!accounts) return [];
    const q = search.toLowerCase().trim();
    let list = accounts;
    if (q) {
      list = list.filter(
        (a) =>
          a.username.toLowerCase().includes(q) ||
          (a.agencyName && a.agencyName.toLowerCase().includes(q)) ||
          (a.email && a.email.toLowerCase().includes(q))
      );
    }
    list = [...list].sort((a, b) => {
      if (sortField === "username") {
        const cmp = a.username.localeCompare(b.username);
        return sortAsc ? cmp : -cmp;
      }
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return sortAsc ? da - db : db - da;
    });
    return list;
  }, [accounts, search, sortField, sortAsc]);

  if (!isAdmin) {
    return <Redirect to="/" />;
  }

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
          <CardTitle data-testid="text-admin-title">All Accounts</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-accounts"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSort("username")}
                        className="gap-1 -ml-3"
                        data-testid="button-sort-name"
                      >
                        Agency / Username
                        <ArrowUpDown className="w-3.5 h-3.5" />
                      </Button>
                    </TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSort("createdAt")}
                        className="gap-1 -ml-3"
                        data-testid="button-sort-date"
                      >
                        Date Created
                        <ArrowUpDown className="w-3.5 h-3.5" />
                      </Button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        {search ? "No accounts match your search." : "No accounts found."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((account) => (
                      <TableRow key={account.id} data-testid={`row-account-${account.id}`}>
                        <TableCell>
                          <div>
                            {account.agencyName && (
                              <div className="font-medium" data-testid={`text-agency-${account.id}`}>
                                {account.agencyName}
                              </div>
                            )}
                            <div className={account.agencyName ? "text-sm text-muted-foreground" : "font-medium"} data-testid={`text-username-${account.id}`}>
                              {account.username}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-email-${account.id}`}>
                          {account.email || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={account.role === "admin" ? "default" : "secondary"}
                            data-testid={`badge-role-${account.id}`}
                          >
                            {account.role}
                          </Badge>
                        </TableCell>
                        <TableCell data-testid={`text-date-${account.id}`}>
                          {account.createdAt
                            ? format(new Date(account.createdAt), "MMM d, yyyy")
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {!isLoading && filtered.length > 0 && (
            <div className="mt-3 text-sm text-muted-foreground" data-testid="text-account-count">
              {filtered.length} account{filtered.length !== 1 ? "s" : ""}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

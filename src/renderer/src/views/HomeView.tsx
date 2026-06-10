import { useState, useEffect } from "react";
import {
  FileText,
  Loader2,
  CheckCircle,
  ListTodo,
  UploadCloud,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";

const chartConfig = {
  count: {
    label: "Count",
    color: "var(--primary)",
  },
  status: {
    label: "Status",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

export function HomeView() {
  const [stats, setStats] = useState<any>(null);
  const [isFetchingStats, setIsFetchingStats] = useState(true);

  useEffect(() => {
    loadStats();

    const removeListener = window.api.onDocumentProgress(() => {
      loadStats();
    });
    
    return () => {
      if (removeListener) removeListener();
    }
  }, []);

  const loadStats = async () => {
    setIsFetchingStats(true);
    const res = await window.api.getDashboardStats();
    if (res.success) {
      setStats(res.data);
    }
    setIsFetchingStats(false);
  };

  return (
    <div className="relative flex flex-col h-full bg-background">
      <div className="flex-1 overflow-y-auto p-6 space-y-6 relative">
        {/* KPIs */}
        <div className="relative">
          {isFetchingStats && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-[1px] rounded-xl pointer-events-none transition-opacity duration-200">
              <div className="bg-card border shadow-lg rounded-full p-2 flex items-center gap-2 pr-4">
                <Loader2 className="size-5 animate-spin text-primary" />
                <span className="text-sm font-medium">Loading KPIs...</span>
              </div>
            </div>
          )}
          {stats && (
            <>
              <div className={stats.totalCandidates === 0 ? "filter blur-sm opacity-40 pointer-events-none select-none transition-all duration-500" : ""}>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Candidates</CardTitle>
                      <FileText className="size-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.totalCandidates}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
                      <ListTodo className="size-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-warning">{stats.pendingReviews}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">New (Last 7 Days)</CardTitle>
                      <UploadCloud className="size-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-info">+{stats.recentAdditions}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Processing Success</CardTitle>
                      <CheckCircle className="size-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-success">
                        {stats.tasksComplete + stats.tasksFailed > 0
                          ? Math.round((stats.tasksComplete / (stats.tasksComplete + stats.tasksFailed)) * 100)
                          : 0}%
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Pipeline Status */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Pipeline Status</CardTitle>
                      <CardDescription>Candidates grouped by current status</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={chartConfig} className="h-37.5 w-full">
                        <BarChart data={stats.pipeline} layout="vertical" margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" />
                          <YAxis dataKey="status" type="category" width={100} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  {/* Job Types */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Job Types</CardTitle>
                      <CardDescription>Distribution of candidates across roles</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={chartConfig} className="h-37.5 w-full">
                        <BarChart data={stats.jobTypes} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  {/* Velocity */}
                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle>Recruitment Velocity</CardTitle>
                      <CardDescription>Candidates added over the last 30 days</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={chartConfig} className="h-37.5 w-full">
                        <AreaChart data={stats.velocity} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" />
                          <YAxis />
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Area type="monotone" dataKey="count" stroke="var(--color-count)" fillOpacity={1} fill="url(#colorCount)" />
                        </AreaChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {stats.totalCandidates === 0 && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none mt-12">
                  <div className="bg-card/90 backdrop-blur-md p-8 rounded-2xl border shadow-xl flex flex-col items-center gap-3 animate-in fade-in zoom-in-95 duration-500">
                    <FileText className="size-10 text-muted-foreground opacity-50 mb-2" />
                    <h3 className="text-xl font-bold tracking-tight">No Data Available</h3>
                    <p className="text-sm text-muted-foreground text-center max-w-[250px]">
                      Your dashboard is empty. Drag and drop some CVs into the window to get started.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

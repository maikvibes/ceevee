import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ArrowLeft,
  MapPin,
  Briefcase,
  DollarSign,
  Loader2,
  Link as LinkIcon,
  GripVertical,
} from "lucide-react";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";

interface CandidateDetailViewProps {
  candidateId: number;
  onBack: () => void;
}

export function CandidateDetailView({
  candidateId,
  onBack,
}: CandidateDetailViewProps) {
  const [candidate, setCandidate] = useState<any>(null);
  const [pdfBase64, setPdfBase64] = useState<ArrayBuffer | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingNotion, setIsSyncingNotion] = useState(false);

  useEffect(() => {
    loadCandidate();
  }, [candidateId]);

  useEffect(() => {
    let url: string | null = null;
    if (pdfBase64) {
      try {
        url = URL.createObjectURL(
          new Blob([pdfBase64], {
            type: "application/pdf",
          }),
        );
        setPdfUrl(url);
      } catch (e) {
        console.error("Failed to create Blob URL for PDF:", e);
      }
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pdfBase64]);

  const loadCandidate = async () => {
    setIsLoading(true);
    const res = await window.api.getCandidate(candidateId);
    if (res.success && res.data) {
      setCandidate(res.data);

      // Load PDF if it is a pdf
      if (
        res.data.file_path &&
        res.data.file_path.toLowerCase().endsWith(".pdf")
      ) {
        const pdfRes = await window.api.readLocalPdf(res.data.file_path);
        if (pdfRes.success && pdfRes.base64) {
          setPdfBase64(pdfRes.base64);
        }
      }
    }
    setIsLoading(false);
  };

  const handleSyncNotion = async () => {
    setIsSyncingNotion(true);
    const res = await window.api.syncCandidateToNotion(candidateId);
    setIsSyncingNotion(false);
    if (res.success) {
      toast.success("Successfully synced to Notion!");
    } else {
      toast.error(`Sync failed: ${res.error}`);
    }
  };

  const parseTags = (tagsStr: string) => {
    try {
      return JSON.parse(tagsStr) || [];
    } catch {
      return [];
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="size-12 animate-spin text-primary opacity-50" />
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="p-8 text-center bg-background h-full">
        <h2 className="text-xl font-semibold mb-4">Candidate not found</h2>
        <Button onClick={onBack}>Go Back</Button>
      </div>
    );
  }

  const tags = parseTags(candidate.tags);

  return (
    <PanelGroup
      orientation="horizontal"
      className="h-full w-full bg-background overflow-hidden"
    >
      {/* Left Pane - Candidate Metadata */}
      <Panel defaultSize={40} minSize={20} className="flex flex-col bg-card/30">
        <div className="p-6 shrink-0 border-b flex items-center justify-between bg-card">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="size-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {candidate.first_name} {candidate.last_name}
              </h1>
              <p className="text-muted-foreground">
                {candidate.headline || "No headline provided"}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncNotion}
            disabled={isSyncingNotion}
            className="gap-2"
          >
            {isSyncingNotion ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LinkIcon className="size-4" />
            )}
            Notion
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {/* Status & Quick Info */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Badge
                variant={
                  candidate.status === "Pending Review"
                    ? "secondary"
                    : "default"
                }
                className="text-sm px-3 py-1"
              >
                {candidate.status}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <MapPin className="size-4" />
                {candidate.location || "Remote/Unspecified"}
              </div>
              <div className="flex items-center gap-2">
                <Briefcase className="size-4" />
                {candidate.job_type || "Full-time"}
              </div>
              <div className="flex items-center gap-2 col-span-2">
                <DollarSign className="size-4" />
                {candidate.salary_expectation || "Open to negotiation"}
              </div>
            </div>
          </div>

          {/* AI Summary */}
          <div className="space-y-3">
            <h3 className="font-semibold text-lg tracking-tight text-foreground">
              AI Profile Summary
            </h3>
            <div className="p-4 bg-muted/50 rounded-lg border border-border/50 text-sm leading-relaxed text-foreground">
              {candidate.summary || "No summary available."}
            </div>
          </div>

          {/* Skills / Tags */}
          <div className="space-y-3">
            <h3 className="font-semibold text-lg tracking-tight text-foreground">
              Extracted Skills
            </h3>
            <div className="flex flex-wrap gap-2">
              {tags.length > 0 ? (
                tags.map((tag: string) => (
                  <Badge key={tag} variant="outline" className="bg-background">
                    {tag}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">
                  No specific skills detected.
                </span>
              )}
            </div>
          </div>

          {/* Contact Details */}
          <div className="space-y-3">
            <h3 className="font-semibold text-lg tracking-tight text-foreground">
              Contact Information
            </h3>
            <div className="text-sm space-y-1">
              <p>
                <span className="text-muted-foreground w-16 inline-block">
                  Email:
                </span>{" "}
                <a
                  href={`mailto:${candidate.email}`}
                  className="text-info hover:underline"
                >
                  {candidate.email || "N/A"}
                </a>
              </p>
              <p>
                <span className="text-muted-foreground w-16 inline-block">
                  Phone:
                </span>{" "}
                {candidate.phone || "N/A"}
              </p>
              {candidate.website && (
                <p>
                  <span className="text-muted-foreground w-16 inline-block">
                    Links:
                  </span>{" "}
                  <a
                    href={candidate.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-info hover:underline"
                  >
                    {candidate.website}
                  </a>
                </p>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <PanelResizeHandle className="w-2 bg-border hover:bg-primary/50 transition-colors cursor-col-resize flex flex-col justify-center items-center group">
        <GripVertical className="size-4 text-transparent group-hover:text-primary-foreground/50" />
      </PanelResizeHandle>

      {/* Right Pane - CV Document Viewer */}
      <Panel
        defaultSize={60}
        minSize={30}
        className="bg-zinc-950 flex flex-col h-full relative"
      >
        {pdfUrl ? (
          <iframe
            src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0`}
            className="w-full h-full border-none"
            title="CV Preview"
          />
        ) : (
          <div className="flex-1 p-12 overflow-y-auto bg-card">
            <div className="max-w-3xl mx-auto space-y-8">
              <div className="border-b pb-4">
                <h2 className="text-2xl font-semibold mb-2">
                  Raw Extracted Text
                </h2>
                <p className="text-sm text-muted-foreground">
                  The original document could not be previewed natively.
                  Displaying extracted text instead.
                </p>
              </div>
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground bg-muted p-6 rounded-lg border border-border">
                {candidate.raw_text || "No raw text extracted."}
              </pre>
            </div>
          </div>
        )}
      </Panel>
    </PanelGroup>
  );
}

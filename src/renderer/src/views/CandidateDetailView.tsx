import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatFileSize } from "../lib/format-file-size";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  MapPin,
  Briefcase,
  DollarSign,
  Loader2,
  Link as LinkIcon,
  GripVertical,
  Trash2,
} from "lucide-react";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";

interface CvVersion {
  id: number;
  original_filename: string;
  file_size: number | null;
  created_at: string;
  raw_text: string | null;
  is_current: boolean;
  available: boolean;
}

interface ArchivedProfile {
  id: number; sourceCandidateId: number; mergedAt: string; firstName: string; lastName: string;
  email: string; phone: string; headline: string; status: string; notionPageUrl: string | null;
}

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
  const [versions, setVersions] = useState<CvVersion[]>([]);
  const [archivedProfiles, setArchivedProfiles] = useState<ArchivedProfile[]>([]);
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null);
  const previewRequest = useRef(0);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [deleteVersion, setDeleteVersion] = useState<CvVersion | null>(null);
  const [confirmResetProfile, setConfirmResetProfile] = useState(false);
  const [versionBusy, setVersionBusy] = useState(false);

  useEffect(() => {
    loadCandidate();
    loadVersions();
    setArchivedProfiles([]);
    window.api.getCandidateMergeHistory(candidateId).then((result) => { if (result.success) setArchivedProfiles(result.data || []); });
    return () => { previewRequest.current++; };
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
    const request = ++previewRequest.current;
    setPdfBase64(null);
    setPdfUrl(null);
    setPreviewVersionId(null);
    setPreviewText(null);
    const res = await window.api.getCandidate(candidateId);
    if (request !== previewRequest.current) return;
    if (res.success && res.data) {
      setCandidate(res.data);

      // Load PDF if it is a pdf
      if (
        res.data.file_path &&
        res.data.file_path.toLowerCase().endsWith(".pdf")
      ) {
        const pdfRes = await window.api.readLocalPdf(res.data.file_path);
        if (request === previewRequest.current && pdfRes.success && pdfRes.base64) {
          setPdfBase64(pdfRes.base64);
        }
      }
    }
    if (request === previewRequest.current) setIsLoading(false);
  };

  const loadVersions = async () => {
    const res = await window.api.getCvVersions(candidateId);
    if (res.success && res.data) setVersions(res.data);
    else toast.error(res.error || "Could not load CV history.");
  };

  const previewVersion = async (version: CvVersion) => {
    const request = ++previewRequest.current;
    setPreviewVersionId(version.id);
    setPreviewText(version.raw_text || "No extracted text available.");
    setPdfBase64(null);
    setPdfUrl(null);
    if (version.available && version.original_filename.toLowerCase().endsWith(".pdf")) {
      const result = await window.api.readCvVersion(candidateId, version.id);
      if (request !== previewRequest.current) return;
      if (result.success && result.data) setPdfBase64(result.data);
      else toast.error(result.error || "Could not open this CV.");
    } else if (!version.available) toast.error("The managed file is unavailable; showing extracted text if available.");
  };

  const makeCurrent = async (version: CvVersion) => {
    setVersionBusy(true);
    try {
      const result = await window.api.setCurrentCvVersion(candidateId, version.id);
      if (!result.success) throw new Error(result.error || "Could not change the current CV.");
      if (result.warning) toast.warning(result.warning);
      await Promise.all([loadCandidate(), loadVersions()]);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setVersionBusy(false); }
  };

  const confirmDeleteVersion = async () => {
    if (!deleteVersion) return;
    setVersionBusy(true);
    try {
      const result = await window.api.deleteCvVersion(candidateId, deleteVersion.id);
      if (!result.success) throw new Error(result.error || "Could not delete the CV.");
      if (result.warning) toast.warning(result.warning);
      setDeleteVersion(null);
      await Promise.all([loadCandidate(), loadVersions()]);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setVersionBusy(false); }
  };

  const resetProfile = async () => {
    setVersionBusy(true);
    try {
      const result = await window.api.resetProfileToCurrentCv(candidateId);
      if (!result.success) throw new Error(result.error || 'Could not apply CV data.');
      if (result.warning) toast.warning(result.warning);
      setConfirmResetProfile(false);
      await loadCandidate();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setVersionBusy(false); }
  };

  const handleSyncNotion = async () => {
    setIsSyncingNotion(true);
    try {
      const res = await window.api.syncCandidateToNotion(candidateId);
      if (res?.success) {
        toast.success("Successfully synced to Notion!");
      } else {
        toast.error(`Sync failed: ${res?.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      toast.error(`Sync failed: ${e.message}`);
    } finally {
      setIsSyncingNotion(false);
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

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-lg tracking-tight">CV history</h3>
              <span className="text-xs text-muted-foreground">{versions.length} {versions.length === 1 ? 'version' : 'versions'}</span>
            </div>
            {candidate.manual_fields && candidate.manual_fields !== '[]' && versions.some((version) => version.is_current) && <div className="space-y-2 text-sm text-muted-foreground">
              <p>Some profile fields are protected from CV updates. Existing profiles are protected when migrated.</p>
              <Button variant="outline" size="sm" disabled={versionBusy} onClick={() => setConfirmResetProfile(true)}>Apply current CV data</Button>
            </div>}
            {versions.length === 0 ? <p className="text-sm text-muted-foreground">No CV versions saved.</p> : (
              <div className="space-y-2">
                {versions.map((version) => (
                  <div key={version.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" onClick={() => void previewVersion(version)} className="text-left text-sm font-medium hover:underline break-all" aria-label={`Preview ${version.original_filename}`}>
                        {version.original_filename}
                      </button>
                      {version.is_current && <Badge variant="secondary">Current</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{new Date(version.created_at).toLocaleDateString()} ? {formatFileSize(version.file_size)}{!version.available ? ' ? File unavailable' : ''}{previewVersionId === version.id ? ' ? Previewing' : ''}</p>
                    <div className="flex items-center gap-2">
                      {!version.is_current && <Button variant="outline" size="sm" disabled={versionBusy} onClick={() => void makeCurrent(version)}>Make current</Button>}
                      <Button variant="ghost" size="sm" disabled={versionBusy} onClick={() => setDeleteVersion(version)} aria-label={`Delete ${version.original_filename}`}><Trash2 className="size-4 mr-1" />Delete</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {archivedProfiles.length > 0 && <div className="space-y-3">
            <h3 className="font-semibold text-lg tracking-tight">Merged profiles</h3>
            {archivedProfiles.map((profile) => <div key={profile.id} className="rounded-lg border p-3 space-y-1 text-sm">
              <p className="font-medium">{profile.firstName} {profile.lastName} <span className="text-muted-foreground">#{profile.sourceCandidateId}</span></p>
              <p className="text-muted-foreground">{profile.email || 'No email'} ? {profile.phone || 'No phone'}</p>
              <p className="text-muted-foreground">{profile.headline || 'No headline'} ? {profile.status || 'No status'}</p>
              {profile.notionPageUrl && <a className="text-info hover:underline" href={profile.notionPageUrl} target="_blank" rel="noreferrer">Previous Notion page</a>}
            </div>)}
          </div>}

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
                {previewText ?? candidate.raw_text ?? "No raw text extracted."}
              </pre>
            </div>
          </div>
        )}
      </Panel>
      <AlertDialog open={confirmResetProfile} onOpenChange={setConfirmResetProfile}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Replace protected profile fields?</AlertDialogTitle><AlertDialogDescription>This applies all fields from the current CV, including empty values, and removes manual field protection. Recruiting status stays unchanged.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={versionBusy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={versionBusy} onClick={(event) => { event.preventDefault(); void resetProfile(); }}>Apply CV data</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!deleteVersion} onOpenChange={(open) => { if (!open) setDeleteVersion(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this CV version?</AlertDialogTitle>
            <AlertDialogDescription>
              The managed copy of {deleteVersion?.original_filename} will be deleted. The original file and any copies already synced to Notion will not be touched. {deleteVersion?.is_current ? 'The newest remaining version will become current; if none remains, the candidate profile will stay.' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={versionBusy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={versionBusy} onClick={(event) => { event.preventDefault(); void confirmDeleteVersion(); }}>Delete version</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PanelGroup>
  );
}

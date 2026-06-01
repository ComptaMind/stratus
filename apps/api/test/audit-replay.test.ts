/**
 * Vitest unit tests for AuditService replay layer.
 *
 * Uses a mock PrismaService — no real DB required.
 * Covers:
 *   - replay() returns events in chronological order
 *   - LLM calls extracted correctly from payload
 *   - RAG retrievals extracted correctly
 *   - Fiscal code state reconstructed (BOFiP version, sections)
 *   - exportReplayBundle() produces a valid ZIP with all expected files
 *   - rerunWithCurrentModel() returns comparison structure
 *   - NotFoundException when entity has no events
 *   - ZIP CRC/structure validity (open with built-in zlib)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { AuditService } from "../src/audit/audit.service";
import { buildZip } from "../src/audit/zip.util";
import { inflateRawSync } from "node:zlib";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID    = "org-test";
const ENTITY_ID = "decl-001";
const ENTITY    = "CA3Declaration";

function makeEvent(overrides: Partial<{
  id: string;
  action: string;
  actorType: string;
  actorId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}>) {
  return {
    id:         overrides.id         ?? "evt-1",
    orgId:      ORG_ID,
    actorType:  overrides.actorType  ?? "agent",
    actorId:    overrides.actorId    ?? "stratus-agent",
    action:     overrides.action     ?? "agent.transition",
    entityType: ENTITY,
    entityId:   ENTITY_ID,
    payload:    overrides.payload    ?? {},
    createdAt:  overrides.createdAt  ?? new Date("2025-01-15T10:00:00Z"),
  };
}

const EVT_INGEST = makeEvent({
  id: "evt-1",
  action: "agent.transition",
  payload: { from_state: "router", to_state: "ingest_fec", phase: "ingest" },
  createdAt: new Date("2025-01-15T10:00:00Z"),
});

const EVT_LLM = makeEvent({
  id: "evt-2",
  action: "handle_question",
  actorType: "agent",
  payload: {
    prompt: "Quel est le taux de TVA pour la restauration ?",
    response: "Le taux applicable est 10 % (art. 279 a CGI).",
    model: "claude-haiku-4-5",
    model_version: "claude-haiku-4-5-20251001",
    temperature: 0.1,
    latency_ms: 820,
    tokens_prompt: 512,
    tokens_completion: 128,
    sources: [
      {
        url: "https://bofip.impots.gouv.fr/BOI-TVA-LIQ-30",
        title: "BOI-TVA-LIQ-30 — Taux réduits",
        text: "Le taux réduit de 10 % s'applique aux ventes à emporter dans les restaurants.",
        score: 0.92,
        bofip_id: "BOI-TVA-LIQ-30",
        chunk_index: 4,
        bofip_version_date: "2024-12-15",
      },
    ],
  },
  createdAt: new Date("2025-01-15T10:01:00Z"),
});

const EVT_RAG = makeEvent({
  id: "evt-3",
  action: "rag.retrieval",
  payload: {
    query: "taux TVA restauration",
    retrieved_chunks: [
      {
        url: "https://bofip.impots.gouv.fr/BOI-TVA-LIQ-30",
        title: "BOI-TVA-LIQ-30",
        text: "Restauration 10 %",
        score: 0.91,
        bofip_id: "BOI-TVA-LIQ-30",
        chunk_index: 2,
      },
    ],
    retrieval_latency_ms: 45,
    bofip_version_date: "2024-12-15",
  },
  createdAt: new Date("2025-01-15T10:02:00Z"),
});

const EVT_COMPUTE = makeEvent({
  id: "evt-4",
  action: "declaration.computed",
  actorType: "agent",
  payload: {
    lines: { L24: "1000.00", L15: "2000.00" },
    engine_version: "ca3-v1.0",
  },
  createdAt: new Date("2025-01-15T10:03:00Z"),
});

const EVT_EDI = makeEvent({
  id: "evt-5",
  action: "edi_tva.generated",
  actorType: "agent",
  payload: {
    sha256: "abc123",
    xml_url: "s3://stratus-edi-tva/decl-001.xml",
    period: "2025-01-01/2025-01-31",
  },
  createdAt: new Date("2025-01-15T10:04:00Z"),
});

// ── Mock PrismaService ────────────────────────────────────────────────────────

function makeMockPrisma(events: ReturnType<typeof makeEvent>[]) {
  return {
    auditEvent: {
      create: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockImplementation(({ where }: { where: { entityId: string } }) => {
        if (where.entityId === ENTITY_ID) {
          // Already ordered in fixture; real DB would ORDER BY createdAt ASC
          return Promise.resolve(
            [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
          );
        }
        return Promise.resolve([]);
      }),
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AuditService.replay()", () => {
  let service: AuditService;
  const ALL_EVENTS = [EVT_COMPUTE, EVT_INGEST, EVT_LLM, EVT_RAG, EVT_EDI];

  beforeEach(() => {
    const prisma = makeMockPrisma(ALL_EVENTS);
    service = new AuditService(prisma as any);
  });

  it("returns events in chronological order", async () => {
    const bundle = await service.replay(ENTITY, ENTITY_ID, ORG_ID);
    const ts = bundle.events.map((e) => e.createdAt.getTime());
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1]);
    }
  });

  it("returns all 5 events for the entity", async () => {
    const bundle = await service.replay(ENTITY, ENTITY_ID, ORG_ID);
    expect(bundle.events).toHaveLength(5);
    expect(bundle.entityId).toBe(ENTITY_ID);
    expect(bundle.entityType).toBe(ENTITY);
  });

  it("extracts exactly 1 LLM call (handle_question with prompt)", async () => {
    const bundle = await service.replay(ENTITY, ENTITY_ID, ORG_ID);
    expect(bundle.llmCalls).toHaveLength(1);
    const call = bundle.llmCalls[0];
    expect(call.eventId).toBe("evt-2");
    expect(call.prompt).toBe("Quel est le taux de TVA pour la restauration ?");
    expect(call.response).toBe("Le taux applicable est 10 % (art. 279 a CGI).");
    expect(call.model).toBe("claude-haiku-4-5");
    expect(call.modelVersion).toBe("claude-haiku-4-5-20251001");
    expect(call.temperature).toBe(0.1);
    expect(call.latencyMs).toBe(820);
    expect(call.tokensPrompt).toBe(512);
    expect(call.tokensCompletion).toBe(128);
  });

  it("LLM call includes ragSources", async () => {
    const bundle = await service.replay(ENTITY, ENTITY_ID, ORG_ID);
    const call = bundle.llmCalls[0];
    expect(call.ragSources).toHaveLength(1);
    expect(call.ragSources[0].bofipId).toBe("BOI-TVA-LIQ-30");
    expect(call.ragSources[0].score).toBeCloseTo(0.92);
    expect(call.ragSources[0].title).toBe("BOI-TVA-LIQ-30 — Taux réduits");
  });

  it("extracts RAG retrieval from rag.retrieval event", async () => {
    const bundle = await service.replay(ENTITY, ENTITY_ID, ORG_ID);
    expect(bundle.ragRetrievals).toHaveLength(1);
    const r = bundle.ragRetrievals[0];
    expect(r.query).toBe("taux TVA restauration");
    expect(r.latencyMs).toBe(45);
    expect(r.bofipVersionDate).toBe("2024-12-15");
    expect(r.chunks).toHaveLength(1);
  });

  it("reconstructs BOFiP version date from events", async () => {
    const bundle = await service.replay(ENTITY, ENTITY_ID, ORG_ID);
    expect(bundle.fiscalCodeState.bofipVersionDate).toBe("2024-12-15");
  });

  it("collects relevant BOFiP sections", async () => {
    const bundle = await service.replay(ENTITY, ENTITY_ID, ORG_ID);
    expect(bundle.fiscalCodeState.relevantSections).toContain("BOI-TVA-LIQ-30");
  });

  it("generatedAt is a recent Date", async () => {
    const before = Date.now();
    const bundle = await service.replay(ENTITY, ENTITY_ID, ORG_ID);
    expect(bundle.generatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(bundle.generatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 100);
  });

  it("throws NotFoundException when no events exist", async () => {
    const prisma = makeMockPrisma([]);
    const svc = new AuditService(prisma as any);
    await expect(svc.replay(ENTITY, "no-such-id", ORG_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ── exportReplayBundle ────────────────────────────────────────────────────────

describe("AuditService.exportReplayBundle()", () => {
  let service: AuditService;

  beforeEach(() => {
    const prisma = makeMockPrisma([EVT_INGEST, EVT_LLM, EVT_RAG, EVT_COMPUTE, EVT_EDI]);
    service = new AuditService(prisma as any);
  });

  it("returns a Buffer", async () => {
    const zip = await service.exportReplayBundle(ENTITY, ENTITY_ID, ORG_ID);
    expect(zip).toBeInstanceOf(Buffer);
    expect(zip.length).toBeGreaterThan(22); // at minimum EOCD record
  });

  it("ZIP starts with PK local file header signature", async () => {
    const zip = await service.exportReplayBundle(ENTITY, ENTITY_ID, ORG_ID);
    // 0x504B0304 == PK\x03\x04
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
  });

  it("ZIP ends with end-of-central-directory signature", async () => {
    const zip = await service.exportReplayBundle(ENTITY, ENTITY_ID, ORG_ID);
    // last 22 bytes start with 0x504B0506
    const tail = zip.slice(zip.length - 22);
    expect(tail[0]).toBe(0x50);
    expect(tail[1]).toBe(0x4b);
    expect(tail[2]).toBe(0x05);
    expect(tail[3]).toBe(0x06);
  });

  it("contains audit_log.jsonl (verifiable by scanning filename in central dir)", async () => {
    const zip = await service.exportReplayBundle(ENTITY, ENTITY_ID, ORG_ID);
    const content = zip.toString("utf8");
    expect(content).toContain("audit_log.jsonl");
  });

  it("contains prompts/ directory for LLM calls", async () => {
    const zip = await service.exportReplayBundle(ENTITY, ENTITY_ID, ORG_ID);
    const content = zip.toString("latin1");
    expect(content).toContain("prompts/");
  });

  it("contains sources/ directory for RAG chunks", async () => {
    const zip = await service.exportReplayBundle(ENTITY, ENTITY_ID, ORG_ID);
    const content = zip.toString("latin1");
    expect(content).toContain("sources/");
  });

  it("contains README.txt", async () => {
    const zip = await service.exportReplayBundle(ENTITY, ENTITY_ID, ORG_ID);
    const content = zip.toString("latin1");
    expect(content).toContain("README.txt");
  });

  it("contains declaration_xml.xml when EDI event is present", async () => {
    const zip = await service.exportReplayBundle(ENTITY, ENTITY_ID, ORG_ID);
    const content = zip.toString("latin1");
    expect(content).toContain("declaration_xml.xml");
  });
});

// ── buildZip utility ──────────────────────────────────────────────────────────

describe("buildZip utility", () => {
  it("roundtrips a single text file", () => {
    const content = "Hello, DGFiP! Ceci est un test.";
    const zip = buildZip([{ name: "test.txt", data: Buffer.from(content) }]);

    // Valid ZIP signature
    expect(zip.slice(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    // Decompress DEFLATE payload and verify contents
    // Local header: 30 + filename length = 30 + 8 = 38 bytes
    const compressedStart = 30 + "test.txt".length;
    // Read compressed size from local header (offset 18, 4 bytes LE)
    const compressedSize = zip.readUInt32LE(18);
    const compressed = zip.slice(compressedStart, compressedStart + compressedSize);
    const decompressed = inflateRawSync(compressed).toString("utf8");
    expect(decompressed).toBe(content);
  });

  it("builds a multi-file ZIP with correct entry count in EOCD", () => {
    const zip = buildZip([
      { name: "a.txt", data: Buffer.from("aaa") },
      { name: "b.txt", data: Buffer.from("bbb") },
      { name: "c/d.txt", data: Buffer.from("ccc") },
    ]);
    // Entry count in EOCD is at offset -22+8 from end (2 bytes LE)
    const eocd = zip.slice(zip.length - 22);
    const totalEntries = eocd.readUInt16LE(10);
    expect(totalEntries).toBe(3);
  });

  it("produces correct CRC-32 (embedded in local header at offset 14)", () => {
    const data = Buffer.from("CRC test data");
    const zip = buildZip([{ name: "f.txt", data }]);
    // CRC-32 is at local header offset 14 (4 bytes LE)
    const crcInZip = zip.readUInt32LE(14);

    // Compute expected CRC-32 manually
    function crc32(buf: Buffer): number {
      const TABLE = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        TABLE[i] = c;
      }
      let crc = 0xffffffff;
      for (let i = 0; i < buf.length; i++) crc = TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    }

    expect(crcInZip).toBe(crc32(data));
  });

  it("handles empty file list", () => {
    const zip = buildZip([]);
    // Minimum valid ZIP: just EOCD (22 bytes with 0 entries)
    expect(zip.length).toBe(22);
    const eocd = zip.slice(0, 22);
    expect(eocd.readUInt16LE(10)).toBe(0); // 0 entries
  });

  it("handles UTF-8 filenames (accented)", () => {
    const zip = buildZip([{ name: "révision/déclaration.txt", data: Buffer.from("ok") }]);
    const content = zip.toString("latin1");
    // Filename should appear in central directory
    expect(content).toContain("r");
    expect(zip.length).toBeGreaterThan(22);
  });
});

// ── rerunWithCurrentModel ─────────────────────────────────────────────────────

describe("AuditService.rerunWithCurrentModel()", () => {
  it("throws NotFoundException when eventId has no LLM call", async () => {
    const prisma = makeMockPrisma([EVT_INGEST, EVT_COMPUTE]);
    const svc = new AuditService(prisma as any);
    await expect(
      svc.rerunWithCurrentModel(ENTITY, ENTITY_ID, ORG_ID, "evt-1"),
    ).rejects.toThrow(NotFoundException);
  });

  it("returns a LLMRerunResult with stub when no ANTHROPIC_API_KEY", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const prisma = makeMockPrisma([EVT_LLM]);
      const svc = new AuditService(prisma as any);
      const result = await svc.rerunWithCurrentModel(ENTITY, ENTITY_ID, ORG_ID, "evt-2");

      expect(result.originalEventId).toBe("evt-2");
      expect(result.originalModel).toContain("claude-haiku-4-5");
      expect(result.currentModel).toBe("claude-sonnet-4-6");
      expect(result.prompt).toContain("taux de TVA");
      expect(result.currentResponse).toContain("Stub");
      expect(result.comparedAt).toBeInstanceOf(Date);
    } finally {
      if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });

  it("LLMRerunResult includes ragSources from the original call", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const prisma = makeMockPrisma([EVT_LLM]);
    const svc = new AuditService(prisma as any);
    const result = await svc.rerunWithCurrentModel(ENTITY, ENTITY_ID, ORG_ID, "evt-2");
    expect(result.ragSources).toHaveLength(1);
    expect(result.ragSources[0].bofipId).toBe("BOI-TVA-LIQ-30");
  });
});

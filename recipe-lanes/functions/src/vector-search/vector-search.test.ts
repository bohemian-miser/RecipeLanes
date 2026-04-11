import fftest from "firebase-functions-test";
import * as transformers from "@huggingface/transformers";
import { searchIconVector } from "./index";
import * as fs from "fs";
import * as path from "path";

// Mock transformers
jest.mock("@huggingface/transformers", () => ({
  pipeline: jest.fn(),
  env: { cacheDir: "" }
}));

const testEnv = fftest();

describe("searchIconVector Cloud Function", () => {
  let wrapped: any;
  const mockEmbedding = new Array(384).fill(0.1);

  beforeAll(async () => {
    // Mock the data directory and index file
    const dataDir = path.resolve(__dirname, "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const indexPath = path.join(dataDir, "icon_index.json");
    const mockData = [
      { id: "apple", embedding: new Array(384).fill(0.1) },
      { id: "banana", embedding: new Array(384).fill(0.5) }
    ];
    fs.writeFileSync(indexPath, JSON.stringify(mockData));

    // Setup mock pipeline return value
    const mockPipeline = async () => ({
      data: new Float32Array(mockEmbedding)
    });
    (transformers.pipeline as jest.Mock).mockResolvedValue(mockPipeline);

    wrapped = testEnv.wrap(searchIconVector);
  });

  afterAll(() => {
    testEnv.cleanup();
  });

  it("should return an embedding and fast matches", async () => {
    const data = { query: "fruit", limit: 5 };
    
    const result = await wrapped({ data });

    expect(result).toBeDefined();
    expect(result.embedding).toBeDefined();
    expect(result.embedding.length).toBe(384);
    expect(result.fast_matches).toBeInstanceOf(Array);
    expect(result.fast_matches.length).toBe(2);
    expect(result.snapshot_timestamp).toBeGreaterThan(0);
    
    // Apple should be the top match because its embedding (all 0.1) 
    // exactly matches our mock query embedding (all 0.1)
    expect(result.fast_matches[0].icon_id).toBe("apple");
    expect(result.fast_matches[0].score).toBeGreaterThan(0.99);
  }, 30000);

  it("should throw an error if query is missing", async () => {
    const data = {};
    await expect(wrapped({ data })).rejects.toThrow();
  });

  it("should respect the limit parameter", async () => {
    const data = { query: "test", limit: 1 };
    const result = await wrapped({ data });
    expect(result.fast_matches.length).toBe(1);
  });
});

const fs = require('fs');
const path = require('path');
const os = require('os');

// Helper to recursively find files with given extension
function findFilesSync(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(ext.toLowerCase())) {
        results.push(path.join(entry.parentPath || dir, entry.name));
      }
    }
  } catch (e) {
    // Fallback if recursive readdir fails
    function walk(current) {
      try {
        const files = fs.readdirSync(current, { withFileTypes: true });
        for (const file of files) {
          const fullPath = path.join(current, file.name);
          if (file.isDirectory()) {
            walk(fullPath);
          } else if (file.isFile() && file.name.toLowerCase().endsWith(ext.toLowerCase())) {
            results.push(fullPath);
          }
        }
      } catch (err) {}
    }
    walk(dir);
  }
  return results;
}

// Helper to get local date string YYYY-MM-DD
function getLocalDateStr(dateObj = new Date()) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Pricing and Equivalent Token Configuration for GPT-Image-2
const IMAGE_PRICING = {
  model: 'GPT-Image-2',
  costPerImage: 0.04, // $0.04 USD
  equivalentTokensPerImage: 20000 // 20k tokens equivalent limit consumption
};

const customDirs = process.env.CODEX_IMAGE_DIRS ? process.env.CODEX_IMAGE_DIRS.split(path.delimiter) : [];
const IMAGE_DIRS = [
  ...customDirs,
  path.join(os.homedir(), '.codex', 'generated_images'),
  'D:\\codex\\generated_images'
];

// Persistent Cache Configuration
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'image-metadata-cache.json');

let memCache = { scannedFiles: {}, metaMap: {} };
if (!fs.existsSync(CACHE_DIR)) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}
}
if (fs.existsSync(CACHE_FILE)) {
  try {
    memCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (!memCache.scannedFiles) memCache.scannedFiles = {};
    if (!memCache.metaMap) memCache.metaMap = {};
  } catch (e) {
    memCache = { scannedFiles: {}, metaMap: {} };
  }
}

// In-memory response cache
let lastAnalysisResult = null;
let lastAnalysisTime = 0;
const ANALYSIS_TTL = 30 * 1000; // 30 seconds

function getCodexImageAnalysis(force = false) {
  const now = Date.now();
  if (!force && lastAnalysisResult && (now - lastAnalysisTime < ANALYSIS_TTL)) {
    return lastAnalysisResult;
  }

  let cacheDirty = false;
  const sessionDir = path.join(os.homedir(), '.codex', 'sessions');

  // 1. Incremental scan of session JSONL files (Check mtimeMs instead of re-reading 4.5 GB)
  if (fs.existsSync(sessionDir)) {
    try {
      function scanDirIncremental(currentDir) {
        let entries;
        try {
          entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch (e) {
          return;
        }

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            scanDirIncremental(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            try {
              const stat = fs.statSync(fullPath);
              if (!memCache.scannedFiles[fullPath] || memCache.scannedFiles[fullPath] !== stat.mtimeMs) {
                // File modified or new: parse lines
                cacheDirty = true;
                const content = fs.readFileSync(fullPath, 'utf8');
                const lines = content.split('\n');
                for (const line of lines) {
                  if (!line || (!line.includes('image_generation') && !line.includes('generate_image'))) continue;
                  try {
                    const obj = JSON.parse(line);
                    const p = obj.payload || {};
                    const ts = obj.timestamp;
                    
                    if (p.type === 'image_generation_end' || p.type === 'image_generation_call') {
                      const callId = p.call_id || p.id;
                      const savedPath = p.saved_path;
                      const prompt = p.prompt || p.revised_prompt;
                      
                      if (callId) {
                        memCache.metaMap[callId] = { prompt, timestamp: ts, savedPath, status: p.status };
                      }
                      if (savedPath) {
                        const base = path.basename(savedPath);
                        memCache.metaMap[base] = { prompt, timestamp: ts, savedPath, status: p.status };
                      }
                    }
                  } catch (e) {}
                }
                memCache.scannedFiles[fullPath] = stat.mtimeMs;
              }
            } catch (err) {}
          }
        }
      }

      scanDirIncremental(sessionDir);

      // Asynchronously persist cache if dirty
      if (cacheDirty) {
        fs.writeFile(CACHE_FILE, JSON.stringify(memCache), () => {});
      }
    } catch (e) {
      console.error('Failed to parse session jsonl for image metadata:', e.message);
    }
  }

  // 2. Fast scan physical image files
  const allImages = [];
  for (const baseDir of IMAGE_DIRS) {
    if (!fs.existsSync(baseDir)) continue;
    try {
      function scanImages(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanImages(fullPath);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
            try {
              const stat = fs.statSync(fullPath);
              const base = entry.name;
              const callId = base.replace(/\.png$/i, '');
              const meta = memCache.metaMap[base] || memCache.metaMap[callId] || {};
              
              let imgDate = '';
              if (meta.timestamp) {
                imgDate = getLocalDateStr(meta.timestamp);
              } else {
                imgDate = getLocalDateStr(stat.mtimeMs);
              }

              allImages.push({
                id: callId,
                filename: base,
                filePath: fullPath,
                fileSize: stat.size,
                date: imgDate,
                timestamp: meta.timestamp || new Date(stat.mtimeMs).toISOString(),
                prompt: meta.prompt || 'Codex 自动化生图工具任务',
                status: meta.status || 'generated',
                model: IMAGE_PRICING.model,
                cost: IMAGE_PRICING.costPerImage,
                tokens: IMAGE_PRICING.equivalentTokensPerImage
              });
            } catch (err) {}
          }
        }
      }

      scanImages(baseDir);
    } catch (e) {
      console.error(`Failed to scan image dir ${baseDir}:`, e.message);
    }
  }

  // Sort chronologically (newest first)
  allImages.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // 3. Group by date
  const byDate = {};
  for (const img of allImages) {
    const d = img.date;
    if (!byDate[d]) {
      byDate[d] = {
        date: d,
        count: 0,
        cost: 0,
        tokens: 0,
        images: []
      };
    }
    byDate[d].count += 1;
    byDate[d].cost += img.cost;
    byDate[d].tokens += img.tokens;
    if (byDate[d].images.length < 5) {
      byDate[d].images.push({
        id: img.id,
        prompt: img.prompt,
        filePath: img.filePath,
        timestamp: img.timestamp
      });
    }
  }

  const dailyTimeline = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  // 4. Totals (Use dynamic local today)
  const totalCount = allImages.length;
  const totalCost = +(totalCount * IMAGE_PRICING.costPerImage).toFixed(2);
  const totalTokens = totalCount * IMAGE_PRICING.equivalentTokensPerImage;

  const todayStr = getLocalDateStr();
  const todayImages = allImages.filter(img => img.date === todayStr);

  lastAnalysisResult = {
    model: IMAGE_PRICING.model,
    totals: {
      totalCount,
      totalCost,
      totalTokens,
      formattedCost: '$' + totalCost.toFixed(2),
      formattedTokens: (totalTokens / 1e6).toFixed(1) + 'M',
      activeDays: dailyTimeline.length,
      todayDate: todayStr,
      todayCount: todayImages.length,
      todayCost: +(todayImages.length * IMAGE_PRICING.costPerImage).toFixed(2),
      todayTokens: todayImages.length * IMAGE_PRICING.equivalentTokensPerImage
    },
    daily: dailyTimeline,
    recentImages: allImages.slice(0, 100).map(img => ({
      id: img.id,
      prompt: img.prompt,
      date: img.date,
      timestamp: img.timestamp,
      filePath: img.filePath,
      fileSize: (img.fileSize / 1024).toFixed(0) + ' KB'
    }))
  };
  lastAnalysisTime = now;

  return lastAnalysisResult;
}

module.exports = {
  getCodexImageAnalysis
};

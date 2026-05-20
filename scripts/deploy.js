const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

// Configuration
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://pratik0165-pulsebackend.hf.space";
const version = process.argv[2];
const adminToken = process.env.ADMIN_TOKEN;

if (!version) {
  console.error("Usage: npm run deploy <version>  (e.g., npm run deploy 1.2.0)");
  process.exit(1);
}

if (!adminToken) {
  console.error("Error: ADMIN_TOKEN environment variable is not set.");
  console.error("Please set it in your environment first:");
  console.error("  PowerShell:  $env:ADMIN_TOKEN=\"your_token\"");
  console.error("  CMD:         set ADMIN_TOKEN=your_token");
  console.error("  Bash:        export ADMIN_TOKEN=\"your_token\"");
  process.exit(1);
}

const webDir = path.join(__dirname, '../out');
const zipPath = path.join(__dirname, '../app-bundle.zip');

try {
  // 1. Build the Next.js app
  console.log("▶  Building Next.js...");
  execSync('npm run build', { stdio: 'inherit' });

  // 2. Verify build output folder exists
  if (!fs.existsSync(webDir)) {
    console.error(`Error: Build directory '${webDir}' not found. Make sure 'npm run build' generates a static export in 'out/'.`);
    process.exit(1);
  }

  // 3. Zip the bundle using AdmZip
  console.log(`▶  Zipping bundle from ${webDir} into ${zipPath}...`);
  const zip = new AdmZip();

  function addLocalFolder(localPath, zipPathPrefix = "") {
    const items = fs.readdirSync(localPath);
    for (const item of items) {
      const fullPath = path.join(localPath, item);
      const stat = fs.statSync(fullPath);
      if (item.endsWith('.map') || item === '.DS_Store') {
        continue;
      }
      const zipEntryPath = zipPathPrefix ? `${zipPathPrefix}/${item}` : item;
      if (stat.isDirectory()) {
        addLocalFolder(fullPath, zipEntryPath);
      } else {
        zip.addLocalFile(fullPath, zipPathPrefix);
      }
    }
  }

  addLocalFolder(webDir);
  zip.writeZip(zipPath);
  console.log("▶  Zipping completed successfully!");

  // 4. Compute SHA-256 Checksum
  console.log("▶  Computing checksum...");
  const fileBuffer = fs.readFileSync(zipPath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  const checksum = hashSum.digest('hex');
  console.log(`▶  Checksum: ${checksum}`);

  // 5. Upload to backend
  console.log(`▶  Uploading to ${apiUrl}/upload ...`);
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  const formData = new FormData();
  formData.append('file', blob, 'app-bundle.pdf');

  fetch(`${apiUrl}/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    },
    body: formData
  })
    .then(res => {
      if (!res.ok) {
        return res.text().then(text => {
          throw new Error(`Upload failed with status ${res.status}: ${text}`);
        });
      }
      return res.json();
    })
    .then(data => {
      const bundleUrl = data.url;
      if (!bundleUrl) {
        throw new Error(`Invalid response, missing URL: ${JSON.stringify(data)}`);
      }

      // Cleanup
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }

      console.log("\n✅  Upload complete!\n");
      console.log("Now paste these into HuggingFace Space → Settings → Repository secrets:");
      console.log("──────────────────────────────────────────────────────────────────────");
      console.log(`  APP_VERSION      = ${version}`);
      console.log(`  BUNDLE_URL       = ${bundleUrl}`);
      console.log(`  BUNDLE_CHECKSUM  = ${checksum}`);
      console.log("──────────────────────────────────────────────────────────────────────");
      console.log("Then click 'Restart space' — users will silently get the update.\n");
    })
    .catch(err => {
      console.error("\n❌ Upload failed:", err.message);
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
      process.exit(1);
    });

} catch (err) {
  console.error("\n❌ Deployment failed:", err.message);
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  process.exit(1);
}

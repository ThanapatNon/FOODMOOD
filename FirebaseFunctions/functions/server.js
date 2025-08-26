const express = require("express");
const { spawn } = require("child_process");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());

// POST /run-fetch-data => calls python fetch_data.py
app.post("/run-fetch-data", (req, res) => {
  // Path to your fetch_data.py:
  const pythonScriptPath = path.join(__dirname, "fetch_data.py");

  // Spawn a child process to run Python
  const pyProcess = spawn("python", [pythonScriptPath]);

  // Collect output
  let outputLogs = "";
  pyProcess.stdout.on("data", (data) => {
    outputLogs += data.toString();
  });

  let errorLogs = "";
  pyProcess.stderr.on("data", (data) => {
    errorLogs += data.toString();
  });

  pyProcess.on("close", (code) => {
    console.log("fetch_data.py closed with code", code);
    if (code === 0) {
      return res.json({
        success: true,
        message: "fetch_data.py ran successfully.",
        logs: outputLogs,
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "fetch_data.py encountered an error.",
        logs: errorLogs || outputLogs,
      });
    }
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Node server listening on http://127.0.0.1:${PORT}`);
});
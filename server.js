import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OK on :${PORT}`));

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Hardcoded users (use consistent "email" field)
const users = [
  { email: process.env.user1_email, password: process.env.user1_pass },
  { email: process.env.user2_email, password: process.env.user2_pass },
  { email: process.env.user3_email, password: process.env.user3_pass },
  { email: process.env.user4_email, password: process.env.user4_pass },
  { email: process.env.user5_email, password: process.env.user5_pass }
];

// Login route
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  const user = users.find(
    (u) => u.email === email && u.password === password
  );

  if (user) {
    res.json({ success: true, message: "Login successful", email });
  } else {
    res.status(401).json({ success: false, message: "Invalid email or password" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

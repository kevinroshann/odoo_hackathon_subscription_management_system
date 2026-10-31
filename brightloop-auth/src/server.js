require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('./db');
const { authenticate, requireRole } = require('./middleware/auth');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', rateLimit({ windowMs: 15 * 60e3, max: 100, standardHeaders: true }));

app.use('/api/auth', require('./routes/auth').router);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/portal', require('./routes/portal'));
// Other members: mount your routers here, protected with authenticate + requireRole
// e.g. app.use('/api/products', authenticate, requireRole('admin'), productsRouter);

app.use(express.static(path.join(__dirname, '../public')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
app.listen(process.env.PORT || 3000, () => console.log(`Brightloop running on :${process.env.PORT || 3000}`));

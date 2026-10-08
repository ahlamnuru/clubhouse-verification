require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const bcrypt = require("bcrypt");
const express = require("express");
const session = require("express-session");
const { body, validationResult } = require("express-validator");
const helmet = require("helmet");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const { UniqueConstraintError } = require("sequelize");
const sequelize = require("./models");
const User = require("./models/user");
const Message = require("./models/message");

User.hasMany(Message, { foreignKey: { name: "UserId", allowNull: false }, onDelete: "CASCADE" });
Message.belongsTo(User, { foreignKey: { name: "UserId", allowNull: false } });

const requiredSecrets = ["SESSION_SECRET", "CLUB_PASSCODE", "ADMIN_PASSCODE"];
for (const name of requiredSecrets) {
  if (!process.env[name]) {
    throw new Error(`${name} is required. Copy .env.example to .env and set it.`);
  }
}

const app = express();
const port = Number(process.env.PORT) || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(helmet());
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    store: new PgSession({
      pool: new Pool({ connectionString: process.env.DATABASE_URL }),
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.error = null;
  next();
});

passport.use(
  new LocalStrategy(
    { usernameField: "email" },
    async (email, password, done) => {
      try {
        const user = await User.scope("withPassword").findOne({
          where: { email: email.toLowerCase() },
        });
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
          return done(null, false, { message: "Email or password is incorrect." });
        }
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    },
  ),
);
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    done(null, await User.findByPk(id));
  } catch (error) {
    done(error);
  }
});

const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  return res.redirect("/login");
};

const requireAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.isAdmin) return next();
  return res.status(403).render("error", {
    title: "Not allowed",
    message: "Only club administrators can do that.",
  });
};

const safeCompare = (provided, expected) => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
};

app.get("/", async (req, res, next) => {
  try {
    const messages = await Message.findAll({
      include: [{ model: User, attributes: ["firstName", "lastName"] }],
      order: [["createdAt", "DESC"]],
    });
    res.render("home", { title: "Clubhouse", messages });
  } catch (error) {
    next(error);
  }
});

app.get("/signup", (req, res) => {
  res.render("signup", { title: "Sign up", errors: [], values: {} });
});

app.post(
  "/signup",
  [
    body("firstName").trim().isLength({ min: 1, max: 60 }).withMessage("First name is required (60 characters max)."),
    body("lastName").trim().isLength({ min: 1, max: 60 }).withMessage("Last name is required (60 characters max)."),
    body("email").trim().isEmail().withMessage("Enter a valid email address.").normalizeEmail(),
    body("password")
      .isLength({ min: 8 })
      .custom((value) => Buffer.byteLength(value, "utf8") <= 72)
      .withMessage("Password must be at least 8 characters and no more than 72 bytes."),
    body("confirmPassword")
      .custom((value, { req }) => value === req.body.password)
      .withMessage("Passwords do not match."),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render("signup", {
        title: "Sign up",
        errors: errors.array(),
        values: req.body,
      });
    }

    try {
      await User.create({
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email,
        passwordHash: await bcrypt.hash(req.body.password, 12),
      });
      return res.redirect("/login?registered=1");
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        return res.status(409).render("signup", {
          title: "Sign up",
          errors: [{ msg: "An account with that email already exists." }],
          values: req.body,
        });
      }
      return next(error);
    }
  },
);

app.get("/login", (req, res) => {
  res.render("login", {
    title: "Log in",
    error: null,
    registered: req.query.registered === "1",
  });
});

app.post("/login", (req, res, next) => {
  passport.authenticate("local", (error, user) => {
    if (error) return next(error);
    if (!user) {
      return res.status(401).render("login", {
        title: "Log in",
        error: "Email or password is incorrect.",
        registered: false,
      });
    }
    return req.logIn(user, (loginError) => {
      if (loginError) return next(loginError);
      return res.redirect("/");
    });
  })(req, res, next);
});

app.post("/logout", requireAuth, (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    req.session.destroy((sessionError) => {
      if (sessionError) return next(sessionError);
      res.clearCookie("connect.sid");
      return res.redirect("/");
    });
  });
});

app.get("/join", requireAuth, (req, res) => {
  res.render("join", { title: "Join the club", error: null });
});

app.post("/join", requireAuth, async (req, res, next) => {
  const passcode = typeof req.body.passcode === "string" ? req.body.passcode : "";
  if (!safeCompare(passcode, process.env.CLUB_PASSCODE)) {
    return res.status(400).render("join", {
      title: "Join the club",
      error: "That passcode is not correct.",
    });
  }
  try {
    await req.user.update({ isMember: true });
    return res.redirect("/");
  } catch (error) {
    return next(error);
  }
});

app.get("/admin-access", requireAuth, (req, res) => {
  res.render("admin-access", { title: "Admin access", error: null });
});

app.post("/admin-access", requireAuth, async (req, res, next) => {
  const passcode = typeof req.body.passcode === "string" ? req.body.passcode : "";
  if (!safeCompare(passcode, process.env.ADMIN_PASSCODE)) {
    return res.status(400).render("admin-access", {
      title: "Admin access",
      error: "That passcode is not correct.",
    });
  }
  try {
    await req.user.update({ isAdmin: true, isMember: true });
    return res.redirect("/");
  } catch (error) {
    return next(error);
  }
});

app.get("/messages/new", requireAuth, (req, res) => {
  res.render("new-message", { title: "Create a message", errors: [], values: {} });
});

app.post(
  "/messages/new",
  requireAuth,
  [
    body("title").trim().isLength({ min: 1, max: 120 }).withMessage("Title is required (120 characters max)."),
    body("text").trim().isLength({ min: 1, max: 5000 }).withMessage("Message is required (5000 characters max)."),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render("new-message", {
        title: "Create a message",
        errors: errors.array(),
        values: req.body,
      });
    }
    try {
      await Message.create({
        title: req.body.title,
        text: req.body.text,
        UserId: req.user.id,
      });
      return res.redirect("/");
    } catch (error) {
      return next(error);
    }
  },
);

app.post("/messages/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    const message = await Message.findByPk(req.params.id);
    if (!message) {
      return res.status(404).render("error", {
        title: "Not found",
        message: "That message does not exist.",
      });
    }
    await message.destroy();
    return res.redirect("/");
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).render("error", { title: "Not found", message: "Page not found." });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  return res.status(500).render("error", {
    title: "Something went wrong",
    message: "The request could not be completed. Please try again.",
  });
});

async function start() {
  await sequelize.authenticate();
  await sequelize.sync();
  app.listen(port, () => {
    console.log(`Clubhouse listening at http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Unable to start the clubhouse:", error);
  process.exitCode = 1;
});

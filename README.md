# Clubhouse message board

A small Express application with PostgreSQL-backed users, messages, and sessions.
Visitors can read message text; club members and administrators can also see
authors and timestamps. Administrators can delete messages.

## Database models

- `User`: first and last name, email (used as username), bcrypt password hash,
  membership status, and administrator status.
- `Message`: title, text, creation timestamp, and a foreign key to its author.

## Set up PostgreSQL

On Debian/Ubuntu, install and start PostgreSQL with:

```sh
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

For other operating systems, install PostgreSQL using its official installer or
your package manager. Then create the database and login role. For a local
PostgreSQL installation with `psql`, run:

```sql
CREATE ROLE clubhouse_user WITH LOGIN PASSWORD 'choose-a-strong-password';
CREATE DATABASE clubhouse OWNER clubhouse_user;
```

If your system's PostgreSQL account is `postgres`, open the SQL prompt with:

```sh
sudo -u postgres psql
```

Paste the SQL statements above, then enter `\q` to exit.

## Install and run

From this project directory:

```sh
npm install
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to match your PostgreSQL username/password.
Choose three separate, private values for `SESSION_SECRET`, `CLUB_PASSCODE`, and
`ADMIN_PASSCODE`. A long random session secret can be generated with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Then start the app:

```sh
npm run dev
```

Open <http://localhost:3000>. For a production-style run, use `npm start`.
The first start connects to PostgreSQL and creates the application tables.

Sign up, log in, then use **Join the club** to enter the club passcode. To set up
an administrator, log in as the intended account and use **Admin access** with
the administrator passcode. Do not publish either passcode.

To install the runtime packages explicitly instead of relying on `package.json`:

```sh
npm install express ejs sequelize pg pg-hstore bcrypt passport passport-local express-session connect-pg-simple express-validator dotenv helmet
```

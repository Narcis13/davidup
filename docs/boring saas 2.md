# The Boring-Stack Template Monorepo — Technical Guidelines

**A single GitHub template repo containing two SaaS scaffolds (Laravel 12 + Livewire 3 + Filament 4, and AdonisJS 6 + Inertia + Vue 3) for Narcis to bootstrap EU/Romanian B2B vertical SaaS products on Hetzner Falkenstein.**

> Research current to May 2026. AdonisJS v7 shipped Feb 25 2026 (per Harminder Virk's announcement, adonisjs.com/blog/v7); this document keeps the "AdonisJS 6" naming used in the brief but flags v7 differences inline. Filament v4 has been stable since Aug 12 2025 (filamentphp.com/insights/alexandersix-filament-v4-is-stable). Versions in §0 are pinned to the latest stable patch on each line.

---

## TL;DR (BLUF)

1. **Pick Laravel when the app is forms-heavy, admin-panel-heavy, or needs Romanian compliance libraries (e-Factura, ANAF); pick AdonisJS when the app is interactive-frontend-heavy or your team thinks in TypeScript.** Both scaffolds share the same Postgres schema, env keys, Docker setup, Hetzner deploy script, Google-OAuth + email/password linking pattern, and CI workflow — so the choice is genuinely just "PHP or TypeScript", not a list of compromises.
2. **For OAuth + password linking, both stacks use a separate `social_accounts` pivot table with `users.password` nullable** — the documented community pattern (TechvBlogs "Social Login with Socialite Laravel", audunru/social-accounts, ankurk91/laravel-socialite-multiple-providers-example). It ports 1:1 between Socialite and Ally, and AdonisJS Ally exposes `emailVerificationState` natively (Socialite requires reading `$user->user['email_verified']` manually).
3. **Hetzner CX22 (~€4/mo post-April-2026 price adjustment, Falkenstein) hosts one app, fronted by Nginx, proxied by Cloudflare Full-Strict.** Use Ploi Basic (€8/mo, up to 5 servers, per ploi.io/pricing) for the Laravel side day one because it cuts hours off the first deploy; roll-your-own SSH+rsync via GitHub Actions for the AdonisJS side because there's no equivalent first-party Node tool.

---

## 0. Locked Versions (as of May 2026)

| Component | Pin | Notes |
|---|---|---|
| PHP | 8.3.x (8.4 OK) | Laravel 12 requires 8.2–8.4 |
| Laravel framework | `^12.0` | released Feb 24 2025; bug-fixes through Aug 13 2026; Laravel 13 due ~March 2026 (laravel.com/docs/12.x/releases) |
| Livewire | `^3.7` | latest 3.x line |
| Filament | `^4.11` | v4 stable since 12 Aug 2025; v5 (Livewire 4) also stable — stay on v4 |
| Laravel Socialite | `^5.24` | v5.24.2, Jan 13 2026 |
| Laravel Fortify | `^1.x` | headless auth |
| Pest | `^3` (or 4) | PHPUnit-compatible |
| Larastan | `^3` | static analysis |
| Pint | `^1` | formatter |
| spatie/laravel-backup | `^9` | R2 destination via S3 driver |
| pristavu/laravel-anaf | `^0.3` | ANAF + e-Factura |
| Node | 22 LTS (24 if AdonisJS 7) | AdonisJS 6 requires Node ≥ 20.6 |
| @adonisjs/core | `^6.x` (7.3.2 on v7) | |
| @adonisjs/lucid | `^21` (`^22` on v7) | |
| @adonisjs/inertia | `^2` (`^3`/`^4` on v7) | |
| @adonisjs/ally | `^5.1` | |
| @adonisjs/auth | `^9.2` | |
| @vinejs/vine | `^3` (`^4` on v7) | |
| Japa | `^3` | testing |
| Vue | `^3.5` | |
| Vite | `^6` | |
| Postgres | 16-alpine | |
| Redis | 7-alpine | optional, only if queues |

---

## 1. Repository Layout

```
boring-saas-template/
├── apps/
│   ├── laravel-app/           # Laravel 12 scaffold
│   └── adonis-app/            # AdonisJS 6 scaffold
├── docs/
│   ├── 00-overview.md
│   ├── 10-laravel.md
│   ├── 20-adonis.md
│   ├── 30-deploy-hetzner.md
│   ├── 40-cloudflare.md
│   └── 50-decision-matrix.md
├── infra/
│   ├── docker-compose.dev.yml
│   ├── nginx/{laravel.conf, adonis.conf}
│   ├── deploy/{bootstrap-cx22.sh, deploy-laravel.sh, deploy-adonis.sh}
│   └── cloudflare/README.md
├── shared/
│   ├── .env.example           # canonical env keys (both apps inherit)
│   ├── sql/seed-tasks.sql
│   └── fixtures/tasks.json
├── .github/workflows/{ci.yml, deploy.yml}
├── .editorconfig
├── .gitignore
├── .nvmrc                     # 22
├── LICENSE                    # MIT
├── lefthook.yml
├── Justfile
└── README.md
```

This is a **GitHub template repository** (Settings → General → "Template repository"). The first command after cloning is `just init <laravel|adonis>`, which deletes the unused scaffold and rewrites the README.

---

# PART 1 — Laravel 12 + Livewire 3 + Filament 4 Scaffold

## 1a. Setup (every command)

```bash
# Prerequisites: PHP 8.3, Composer 2.7+, Node 22, Postgres 16
composer global require laravel/installer

# Bootstrap with the Livewire starter kit
cd apps/
laravel new laravel-app --using=laravel/livewire-starter-kit --database=pgsql --git=false
cd laravel-app

# Dev tooling
composer require --dev laravel/pint larastan/larastan \
    pestphp/pest pestphp/pest-plugin-laravel barryvdh/laravel-debugbar

# Auth backbone
composer require laravel/fortify laravel/socialite

# Filament 4 admin
composer require filament/filament:"^4.11"
php artisan filament:install --panels

# Compliance + ops
composer require spatie/laravel-backup spatie/laravel-permission \
                 spatie/laravel-medialibrary pristavu/laravel-anaf \
                 sentry/sentry-laravel
composer require league/flysystem-aws-s3-v3:"^3.0"     # for R2

# Queues + log viewer
composer require laravel/horizon opcodesio/log-viewer
```

The Livewire starter kit per Laravel 12 docs "utilizes Livewire 3 (for smooth full-stack reactivity), TypeScript, Tailwind, and Flux UI components" and ships login/registration/password-reset/email-verification with Fortify under the hood. Because Breeze and Jetstream stopped receiving updates with Laravel 12 ("With the introduction of our new application starter kits, Laravel Breeze and Laravel Jetstream will no longer receive additional updates" — laravel.com/docs/12.x/releases), this is the only forward-compatible choice for a 2026 template.

### `.env` (canonical keys — Laravel side, mirrored in AdonisJS)

```ini
APP_NAME="Boring SaaS"
APP_ENV=local
APP_KEY=
APP_URL=http://localhost:8000
APP_DEBUG=true
APP_LOCALE=ro
APP_TIMEZONE=Europe/Bucharest

DB_CONNECTION=pgsql
DATABASE_URL=postgresql://saas:saas@127.0.0.1:5432/saas

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI="${APP_URL}/auth/google/callback"

MAIL_MAILER=smtp
MAIL_HOST=127.0.0.1
MAIL_PORT=1025                     # Mailpit in dev
MAIL_FROM_ADDRESS="hello@example.test"

QUEUE_CONNECTION=database          # switch to redis at ~10k jobs/day
SESSION_DRIVER=database

FILESYSTEM_DISK=local
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_ENDPOINT=
R2_REGION=auto

SENTRY_LARAVEL_DSN=

ANAF_CLIENT_ID=
ANAF_CLIENT_SECRET=
ANAF_REDIRECT_URI="${APP_URL}/auth/anaf/callback"
```

## 1b. Filament 4 (admin) coexisting with Livewire 3 (customer)

Filament 4 panels and standalone Livewire components coexist cleanly because Filament 4 *is* Livewire 3 underneath. Per filamentapps.com's "Embedding Livewire Components in Filament 4 Schemas", v4's unified Schemas API lets a panel embed customer-side Livewire components via `Filament\Schemas\Components\Livewire::make(LeadAddresses::class)`. The official filamentphp.com docs state: "Many parts of Filament do not require you to touch Livewire at all, but building custom components might."

**Convention for this template:**
- `/admin/*` → Filament panel (staff). Resources in `app/Filament/Admin/Resources/`.
- `/dashboard`, `/tasks/*` → plain Livewire 3 + Volt components (customers). Files in `resources/views/livewire/` and `app/Livewire/`.
- Both reuse the same `users`, `social_accounts`, `tasks` tables. Panel access gated by an `is_admin` boolean or Spatie role.

Volt single-file components live next to the Blade view and contain both the `\<?php use function Livewire\Volt\{state, computed};` block and markup. They're the recommended default for net-new Livewire components in Laravel 12.

## 1c. Tasks CRUD

### Migration (`database/migrations/2026_05_11_000001_create_tasks_table.php`)

```php
return new class extends Migration {
    public function up(): void {
        Schema::create('tasks', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->string('title');
            $t->text('description')->nullable();
            $t->string('status')->default('todo');     // todo|in_progress|done
            $t->string('priority')->default('medium'); // low|medium|high
            $t->timestamp('due_date')->nullable();
            $t->jsonb('metadata')->nullable();         // Postgres jsonb (GIN-indexable)
            $t->timestamps();
            $t->index(['user_id', 'status']);
        });
    }
    public function down(): void { Schema::dropIfExists('tasks'); }
};
```

Use string columns + PHP enums (not native Postgres enums) — Laravel migrations can't `ALTER TYPE` natively. Define `app/Enums/TaskStatus.php` and `TaskPriority.php`, cast on the model.

### Eloquent model

```php
class Task extends Model {
    use HasFactory;
    protected $fillable = ['title','description','status','priority','due_date','metadata'];
    protected $casts = [
        'status'   => TaskStatus::class,
        'priority' => TaskPriority::class,
        'due_date' => 'datetime',
        'metadata' => 'array',
    ];
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
```

### Customer-facing: Volt component

```php
<?php
use function Livewire\Volt\{state, computed};
use App\Models\Task;
use Illuminate\Support\Facades\Auth;

state(['filter' => 'all']);

$tasks = computed(fn () =>
    Task::where('user_id', Auth::id())
        ->when($this->filter !== 'all', fn ($q) => $q->where('status', $this->filter))
        ->latest()->paginate(20)
);

$delete = function (Task $task) {
    $this->authorize('delete', $task);
    $task->delete();
};
?>

<div>
    <flux:tabs wire:model.live="filter">
        <flux:tab name="all">All</flux:tab>
        <flux:tab name="todo">Todo</flux:tab>
        <flux:tab name="in_progress">In progress</flux:tab>
        <flux:tab name="done">Done</flux:tab>
    </flux:tabs>
    {{-- table + actions --}}
</div>
```

### Admin: Filament resource

```bash
php artisan make:filament-resource Task --generate
```

```php
public static function form(Schema $schema): Schema {
    return $schema->components([
        TextInput::make('title')->required()->maxLength(255),
        Textarea::make('description')->columnSpanFull(),
        Select::make('status')->options(TaskStatus::class)->required(),
        Select::make('priority')->options(TaskPriority::class)->required(),
        DateTimePicker::make('due_date'),
        Select::make('user_id')->relationship('user', 'email')->required(),
    ]);
}
```

### Authorization (`app/Policies/TaskPolicy.php`)

```php
public function view(User $user, Task $task): bool   { return $user->id === $task->user_id; }
public function update(User $user, Task $task): bool { return $user->id === $task->user_id; }
public function delete(User $user, Task $task): bool { return $user->id === $task->user_id; }
```

### Happy-path Pest test

```php
it('lets an authenticated user create, list and delete a task', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $this->post('/tasks', [
        'title' => 'Send VAT report', 'priority' => 'high', 'status' => 'todo',
    ])->assertRedirect();

    expect(Task::where('user_id', $user->id)->count())->toBe(1);

    $task = Task::first();
    $this->delete("/tasks/{$task->id}")->assertRedirect();
    expect(Task::count())->toBe(0);
});
```

## 1d. Google OAuth + email/password linking (Laravel side)

### Canonical schema (identical in AdonisJS)

```php
Schema::table('users', fn (Blueprint $t) => $t->string('password')->nullable()->change());

Schema::create('social_accounts', function (Blueprint $t) {
    $t->id();
    $t->foreignId('user_id')->constrained()->cascadeOnDelete();
    $t->string('provider');           // 'google'
    $t->string('provider_id');        // OAuth subject
    $t->string('provider_email')->nullable();
    $t->timestamps();
    $t->unique(['provider', 'provider_id']);
});
```

Why this shape: per TechvBlogs ("Social Login with Socialite Laravel"), *"we need to set default nullable to our password column because in social account login or register we don't need password"*; per `audunru/social-accounts` README, *"the password column must be nullable because users who sign up this way won't have password"*. Pivot rather than per-provider columns scales to >1 provider without re-migrating.

### Controller (`app/Http/Controllers/Auth/SocialLoginController.php`)

Adapted from the TechvBlogs `SocialLoginController::providerCallback` flow, with verified-email guarding added:

```php
public function callback(string $provider) {
    $social = Socialite::driver($provider)->user();

    // 1. Existing social account → log in
    $account = SocialAccount::firstWhere([
        'provider' => $provider, 'provider_id' => $social->getId(),
    ]);
    if ($account) {
        Auth::login($account->user, remember: true);
        return redirect('/dashboard');
    }

    // 2. Same verified email already in users → link the social account
    $verified = (bool) data_get($social->user, 'email_verified', false);
    $user = $verified ? User::firstWhere('email', $social->getEmail()) : null;

    // 3. No user → create with NULL password
    if (! $user) {
        $user = User::create([
            'name'              => $social->getName(),
            'email'             => $social->getEmail(),
            'email_verified_at' => $verified ? now() : null,
            'password'          => null,
        ]);
    }

    $user->socialAccounts()->create([
        'provider'       => $provider,
        'provider_id'    => $social->getId(),
        'provider_email' => $social->getEmail(),
    ]);

    Auth::login($user, remember: true);
    return redirect('/dashboard');
}
```

For the **reverse direction** (user with password adds Google), reuse `/auth/google/redirect`; the callback short-circuits to "attach social account to currently-authenticated user" when `Auth::check()`. For an OAuth-only user to add a password later, expose `/account/set-password` calling Fortify's `UpdatePassword` action — Fortify accepts "no current password" as valid when the hash is null. This is documented by `ankurk91/laravel-socialite-multiple-providers-example`: *"Allow users to change their account password without knowing the current, because they have logged-in via socialite."*

Email verification uses Fortify's `emailVerification` feature with the User implementing `MustVerifyEmail`. Override `sendEmailVerificationNotification()` with a `ShouldQueue` notification (dev.to "Queueing up Laravel Fortify email verification") so registration doesn't block.

## 1e. Postgres patterns

- Use `jsonb` (not `json`) for any extensible metadata column — GIN indexes work on jsonb.
- `HasUuids` in Laravel 12 now generates UUIDv7 by default (ordered) — use for high-write tables.
- Romanian full-text search: add a `tsvector` column in raw `DB::statement(...)` migrations.
- Always set `DB_CONNECTION=pgsql` and use the `DATABASE_URL` env var; Laravel 12 parses it natively.

## 1f. Deployment to Hetzner CX22

- **VPS**: Hetzner CX22 (2 vCPU / 4 GB RAM, Falkenstein FSN1). Per Hetzner's own announcement at hetzner.com/news/new-cx-plans/, CX22 was originally €3.79/month; the April 1, 2026 price adjustment (docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) raised it modestly — the devtoolpicks 2026 review now references "a Hetzner CX22 at roughly €4/month." Sufficient for at least 3–4 small Laravel SaaS apps.
- **Provisioning**: **Ploi Basic** at €8/mo (per ploi.io/pricing — "Basic €8/$10 per month", up to 5 servers, unlimited sites and deployments). It provisions Nginx + PHP-FPM 8.3 + Postgres + Redis + Supervisor + UFW + Fail2ban in one click and runs a Laravel deploy script.
- Alternative: **Coolify self-hosted** on the same CX22 (free, Docker-based). The devtoolpicks Mar 24 2026 article "Laravel Forge vs Ploi vs Coolify: Which Should Solo Devs Use in 2026?" states: *"Coolify on a Hetzner CX22 is a legitimately good setup. Just accept there's a learning curve."* Self-hosted Coolify saves up to $228/year vs Forge Growth ($19 × 12). Switch to Coolify at 4+ active projects.
- **Why not Laravel Forge here**: Forge Growth is $19/mo (per luckymedia.dev/insights/laravel-forge: "Growth ($19/mo, unlimited servers)") and the Hobby plan only allows 1 external server, so the moment you want staging+prod separation you're on Growth. Ploi Basic covers identical functionality for €8.

**Nginx config (over the Ploi-provisioned default):**

```nginx
server {
    listen 80;
    server_name app.example.ro;
    root /home/ploi/app.example.ro/current/public;
    index index.php;

    real_ip_header CF-Connecting-IP;
    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 103.21.244.0/22;
    # ... full Cloudflare set from cloudflare.com/ips-v4

    location / { try_files $uri $uri/ /index.php?$query_string; }
    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }
}
```

**OPcache** (`/etc/php/8.3/fpm/conf.d/10-opcache.ini`):
```ini
opcache.enable=1
opcache.memory_consumption=256
opcache.max_accelerated_files=20000
opcache.validate_timestamps=0
opcache.preload=/home/ploi/app.example.ro/current/preload.php
```

**Queue**: ship with `QUEUE_CONNECTION=database` and `php artisan queue:work --tries=3` under Supervisor. **Upgrade to Horizon + Redis** when scheduled or async jobs cross ~10k/day. Per Vincent Boon's dev.to "My Laravel Horizon preferences after 5 years of using it" (May 29, 2025), the recommended job design is "slim, single-responsibility jobs … decoupling the logic from your job provides a few advantages, first of all your logic is not dependent on a job and can be called from anywhere" — adopt this from day one.

**Scheduler**: `* * * * * cd /home/ploi/app.example.ro/current && php artisan schedule:run >> /dev/null 2>&1`.

**Backups**: spatie/laravel-backup to Cloudflare R2 via the league/flysystem-aws-s3-v3 adapter, following Antoine Lamé's "Add Cloudflare R2 storage to Laravel in 5 minutes" pattern:

```php
// config/filesystems.php
'r2' => [
    'driver' => 's3',
    'key'    => env('R2_ACCESS_KEY_ID'),
    'secret' => env('R2_SECRET_ACCESS_KEY'),
    'region' => 'auto',
    'bucket' => env('R2_BUCKET'),
    'endpoint' => env('R2_ENDPOINT'),
    'use_path_style_endpoint' => true,
],
```

```php
// config/backup.php
'destination' => ['disks' => ['r2'], 'filename_prefix' => 'saas-'],
'cleanup' => [
    'default_strategy' => [
        'keep_all_backups_for_days' => 7,
        'keep_daily_backups_for_days' => 30,
        'keep_weekly_backups_for_weeks' => 8,
        'keep_monthly_backups_for_months' => 12,
        'keep_yearly_backups_for_years' => 3,
        'delete_oldest_backups_when_using_more_megabytes_than' => 10000,
    ],
],
```

---

# PART 2 — AdonisJS 6 + Inertia + Vue 3 Scaffold

## 2a. Setup

```bash
# Prerequisites: Node 22 (or 24 if on AdonisJS 7), pnpm
cd apps/
npm init adonisjs@latest adonis-app -- \
    --kit=inertia --adapter=vue --ssr --auth-guard=session --db=postgres

cd adonis-app
node ace add @adonisjs/ally --providers=google
node ace add @adonisjs/mail
node ace add @adonisjs/bouncer
node ace add adonisjs-scheduler
npm i @sentry/node
```

The official Inertia starter kit ships with session auth (not JWT), Postgres-ready Lucid, Vite, Tuyau (type-safe routing) and Vue Sonner — per github.com/adonisjs/starter-kits: "Build modern single-page applications with Vue while keeping the simplicity of server-side routing. … Includes: Vue 3, Inertia.js, Tuyau (type-safe routing), Vue Sonner (toast notifications)." SSR is enabled by `--ssr`; recommended because Narcis's customer-facing pages need SEO indexability.

## 2b. Inertia + Vue 3 layout

```
inertia/
├── app.ts                # client entry
├── ssr.ts                # SSR entry
├── pages/
│   ├── auth/{login,register,forgot_password,verify_email}.vue
│   ├── dashboard.vue
│   └── tasks/{index,show,create,edit}.vue
├── layouts/
│   └── default.vue
├── composables/
│   └── useToast.ts
└── css/app.css
```

Controllers render via `inertia.render('tasks/index', { tasks })`. Forms use `useForm()` from `@inertiajs/vue3`; validation errors from VineJS flash to session and appear as `form.errors.title` in Vue.

## 2c. Auth (mirrors Laravel pattern)

**Lucid models**: `User` (nullable `password` via `AuthFinder` mixin), `SocialAccount`.

```ts
// app/models/social_account.ts
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
export default class SocialAccount extends BaseModel {
  @column({ isPrimary: true }) declare id: number
  @column() declare userId: number
  @column() declare provider: 'google'
  @column() declare providerId: string
  @column() declare providerEmail: string | null
  @belongsTo(() => User) declare user: BelongsTo<typeof User>
}
```

Migration mirrors §1d byte-for-byte.

### Google callback

Adapted from the AdonisJS docs' canonical Ally `firstOrCreate` example (docs.adonisjs.com/guides/auth/social-authentication), hardened with the verified-email guard and the social-accounts pivot:

```ts
async callback({ ally, auth, response }: HttpContext) {
  const google = ally.use('google')
  if (google.accessDenied())  return response.redirect('/login?error=denied')
  if (google.stateMisMatch()) return response.redirect('/login?error=state')
  if (google.hasError())      return response.redirect('/login?error=oauth')

  const profile = await google.user()

  // 1. Existing social account
  const account = await SocialAccount.query()
    .where('provider', 'google').where('providerId', profile.id).first()
  if (account) {
    await auth.use('web').login(await account.related('user').query().firstOrFail())
    return response.redirect('/dashboard')
  }

  // 2. Verified email → link
  let user: User | null = null
  if (profile.emailVerificationState === 'verified' && profile.email) {
    user = await User.findBy('email', profile.email)
  }

  // 3. Create with null password
  if (!user) {
    user = await User.create({
      email: profile.email!,
      fullName: profile.name,
      password: null,
      emailVerifiedAt: profile.emailVerificationState === 'verified' ? DateTime.now() : null,
    })
  }

  await user.related('socialAccounts').create({
    provider: 'google',
    providerId: profile.id,
    providerEmail: profile.email,
  })

  await auth.use('web').login(user)
  return response.redirect('/dashboard')
}
```

The AdonisJS docs explicitly tell you to gate on the verified flag: *"Providers handle email verification differently. Check `emailVerificationState` before trusting the email: **verified**: The provider has verified this email address."*

**Email verification + password reset**: follow the Adocasts "Building with AdonisJS & Inertia" series pattern (adocasts.com/series/building-with-inertiajs) — generate signed tokens, store in `email_verification_tokens`, send via `@adonisjs/mail`, verify with a dedicated action class. Same pattern for forgot-password.

## 2d. Tasks CRUD

Migration matches the Laravel one byte-for-byte:

```ts
this.schema.createTable('tasks', (t) => {
  t.bigIncrements('id')
  t.bigInteger('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')
  t.string('title').notNullable()
  t.text('description').nullable()
  t.string('status').notNullable().defaultTo('todo')
  t.string('priority').notNullable().defaultTo('medium')
  t.timestamp('due_date').nullable()
  t.jsonb('metadata').nullable()
  t.timestamps(true, true)
  t.index(['user_id', 'status'])
})
```

**VineJS validator** (`app/validators/task.ts`):
```ts
import vine from '@vinejs/vine'
export const createTaskValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().optional(),
    status: vine.enum(['todo','in_progress','done']),
    priority: vine.enum(['low','medium','high']),
    dueDate: vine.date().optional(),
  })
)
```

**Controller**:
```ts
async index({ inertia, auth }: HttpContext) {
  const tasks = await Task.query().where('userId', auth.user!.id).orderBy('createdAt', 'desc')
  return inertia.render('tasks/index', { tasks })
}
async store({ request, auth, response, bouncer }: HttpContext) {
  await bouncer.with(TaskPolicy).authorize('create')
  const data = await request.validateUsing(createTaskValidator)
  await Task.create({ ...data, userId: auth.user!.id })
  return response.redirect().toRoute('tasks.index')
}
```

**Bouncer policy** (per docs.adonisjs.com/guides/security/authorization):
```ts
export default class TaskPolicy extends BasePolicy {
  view = (user: User, task: Task) => user.id === task.userId
  update = (user: User, task: Task) => user.id === task.userId
  delete = (user: User, task: Task) => user.id === task.userId
}
```

**Japa happy-path test**:
```ts
test('user can create, list and delete a task', async ({ client, route }) => {
  const user = await UserFactory.create()
  await client.post(route('tasks.store'))
    .loginAs(user)
    .form({ title: 'Send VAT report', status: 'todo', priority: 'high' })
    .assertRedirectsTo('/tasks')
})
```

## 2e. Deployment to Hetzner CX22

No first-party Node equivalent to Ploi — use either **Coolify** (Docker-based, recommended once you have 4+ projects) or **roll-your-own** GitHub Actions + SSH (recommended for the template default).

**Build pipeline** (per the AdonisJS docs, github.com/adonisjs/v6-docs/blob/main/content/docs/getting_started/deployment.md): `node ace build --production` writes to `./build`; copy `./build` to the server and treat it as the root of the deployed app.

**PM2 ecosystem (`build/ecosystem.config.cjs`)** — the official AdonisJS docs example:
```js
module.exports = {
  apps: [{
    name: 'adonis-app', script: './bin/server.js',
    instances: 'max', exec_mode: 'cluster', autorestart: true,
    env: { NODE_ENV: 'production', PORT: 3333, HOST: '127.0.0.1' },
    max_memory_restart: '500M',
  }],
}
```

**Nginx** (in front of PM2):
```nginx
upstream adonis_app { server 127.0.0.1:3333 keepalive 32; }
server {
    listen 80;
    server_name app2.example.ro;
    real_ip_header CF-Connecting-IP;
    location / {
        proxy_pass http://adonis_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 50s;
    }
    location /assets/ {
        alias /home/deploy/adonis-app/current/public/assets/;
        expires 1y; add_header Cache-Control "public, immutable";
    }
}
```

The AdonisJS deployment docs warn explicitly: *"By default, Node.js closes idle connections after 5 seconds, but Nginx may try to keep them open for 60+ seconds … you need to change AdonisJS server's keepAliveTimeout to larger than Nginx's proxy_read_timeout (50s by default)."* Set `server.keepAliveTimeout = 60_000` in `config/app.ts`.

**Queue**: AdonisJS 6 has no first-party queue. Ship `bullmq` + `ioredis` with a `start/queue.ts` that boots a worker via a `node ace queue:work` command under PM2. If a project doesn't need queues, delete the file and the redis service.

**Scheduler**: `adonisjs-scheduler` (npmjs.com/package/adonisjs-scheduler) is the de-facto standard (96★, 42k installs, last updated Feb 2026). Runs as `pm2 start "node ace scheduler:run" --name adonis-scheduler`. Usage:
```ts
// start/scheduler.ts
import scheduler from 'adonisjs-scheduler/services/main'
scheduler.command('purge:users', ['30 days']).daily()
```

**Backups**: `pg_dump | gzip | rclone copyto r2:bucket/...` scheduled daily through `adonisjs-scheduler`. R2 creds in `.env`.

---

# PART 3 — Shared Monorepo Infrastructure

## 3a. Local dev (`infra/docker-compose.dev.yml`)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: saas, POSTGRES_PASSWORD: saas, POSTGRES_DB: saas }
    ports: ["5432:5432"]
    volumes: ["pg-data:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "saas"]
      interval: 5s

  mailpit:
    image: axllent/mailpit:latest
    ports: ["1025:1025", "8025:8025"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    profiles: ["queue"]
volumes: { pg-data: {} }
```

Tool versions via **mise** (preferred over asdf in 2026 — single Go binary, reads `.tool-versions`). Root `.mise.toml`:
```toml
[tools]
php = "8.3"
node = "22"
pnpm = "9"
postgresql = "16"
```

## 3b. Justfile (unified DX)

```makefile
set dotenv-load
default:
    @just --list

db-up:        ; docker compose -f infra/docker-compose.dev.yml up -d postgres mailpit
db-reset:     ; docker compose -f infra/docker-compose.dev.yml down -v && just db-up
queue-up:     ; docker compose -f infra/docker-compose.dev.yml --profile queue up -d

laravel-install: ; cd apps/laravel-app && composer install && cp -n .env.example .env && php artisan key:generate && php artisan migrate --seed
laravel-up:      ; cd apps/laravel-app && php artisan serve & npm run dev
laravel-test:    ; cd apps/laravel-app && ./vendor/bin/pest
laravel-deploy:  ; ssh ploi@$LARAVEL_HOST 'cd /home/ploi/app && ./deploy.sh'

adonis-install:  ; cd apps/adonis-app && npm install && cp -n .env.example .env && node ace generate:key && node ace migration:run
adonis-up:       ; cd apps/adonis-app && npm run dev
adonis-test:     ; cd apps/adonis-app && node ace test
adonis-deploy:   ; gh workflow run deploy.yml --field app=adonis
```

## 3c. Pre-commit hooks — **lefthook**

Choose **lefthook** over husky because it's polyglot (PHP + JS in one config), parallel, and monorepo-aware via `glob:` filters. Per pkgpulse.com's "husky vs lefthook vs lint-staged 2026" comparison: *"lefthook is approaching 1 million weekly downloads, growing steadily as its parallel execution model gains recognition. Originally developed at Evil Martians for Ruby on Rails projects, it has found significant adoption in TypeScript monorepos where sequential husky hooks create frustrating commit experiences."*

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    laravel-pint:
      root: "apps/laravel-app/"
      glob: "*.php"
      run: ./vendor/bin/pint {staged_files}
      stage_fixed: true
    adonis-eslint:
      root: "apps/adonis-app/"
      glob: "*.{ts,vue}"
      run: npx eslint --fix {staged_files}
      stage_fixed: true
    adonis-prettier:
      root: "apps/adonis-app/"
      glob: "*.{ts,vue,json,md}"
      run: npx prettier --write {staged_files}
      stage_fixed: true
commit-msg:
  commands:
    conventional:
      run: npx --no commitlint --edit {1}
```

## 3d. GitHub Actions

**`.github/workflows/ci.yml`** — paths-filter matrix using dorny/paths-filter (per GitHub community discussion #177835: *"The dorny/paths-filter action is the industry standard for this use case"*):

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      laravel: ${{ steps.f.outputs.laravel }}
      adonis:  ${{ steps.f.outputs.adonis }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: f
        with:
          filters: |
            laravel:
              - 'apps/laravel-app/**'
              - 'shared/**'
            adonis:
              - 'apps/adonis-app/**'
              - 'shared/**'
  laravel:
    needs: changes
    if: needs.changes.outputs.laravel == 'true'
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_PASSWORD: saas, POSTGRES_USER: saas, POSTGRES_DB: saas_test }
        ports: ["5432:5432"]
        options: --health-cmd "pg_isready -U saas" --health-interval 5s
    defaults: { run: { working-directory: apps/laravel-app } }
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with: { php-version: '8.3', extensions: 'pgsql, intl, redis', coverage: none }
      - run: composer install --prefer-dist --no-progress
      - run: ./vendor/bin/pint --test
      - run: ./vendor/bin/phpstan analyse
      - run: php artisan migrate --force
      - run: ./vendor/bin/pest --parallel
        env: { DATABASE_URL: postgresql://saas:saas@127.0.0.1:5432/saas_test }
  adonis:
    needs: changes
    if: needs.changes.outputs.adonis == 'true'
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_PASSWORD: saas, POSTGRES_USER: saas, POSTGRES_DB: saas_test }
        ports: ["5432:5432"]
    defaults: { run: { working-directory: apps/adonis-app } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: apps/adonis-app/package-lock.json }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: node ace migration:run --force
      - run: node ace test
        env: { DATABASE_URL: postgresql://saas:saas@127.0.0.1:5432/saas_test }
  required:
    needs: [laravel, adonis]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: |
          if [[ "${{ needs.laravel.result }}" == "failure" || "${{ needs.adonis.result }}" == "failure" ]]; then exit 1; fi
```

The `required` aggregator job is the standard workaround (per GitHub community discussion #26251) for making branch-protection required-checks work with `paths-filter`-conditioned jobs.

**`.github/workflows/deploy.yml`** — scoped per scaffold:

```yaml
name: Deploy
on:
  workflow_dispatch:
    inputs:
      app: { description: 'laravel | adonis', required: true }
  push:
    branches: [main]
    paths: ['apps/laravel-app/**', 'apps/adonis-app/**']
jobs:
  laravel:
    if: github.event.inputs.app == 'laravel'
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.LARAVEL_HOST }}
          username: ploi
          key: ${{ secrets.PLOI_SSH_KEY }}
          script: |
            cd /home/ploi/app.example.ro
            git pull origin main
            composer install --no-dev --optimize-autoloader
            php artisan migrate --force
            php artisan optimize:clear && php artisan optimize
            sudo service php8.3-fpm reload
  adonis:
    if: github.event.inputs.app == 'adonis'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: |
          cd apps/adonis-app && npm ci && node ace build --production
          cd build && npm ci --omit=dev && tar czf ../release.tgz .
      - uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.ADONIS_HOST }}
          username: deploy
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          source: apps/adonis-app/release.tgz
          target: /home/deploy/releases/
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.ADONIS_HOST }}
          username: deploy
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd /home/deploy
            mkdir -p releases/$(date +%s) && cd $_
            tar xzf ../release.tgz
            ln -sfn $PWD ../current
            pm2 reload current/ecosystem.config.cjs --update-env
            cd current && node ace migration:run --force
```

## 3e. Hetzner specifics

**Both apps can share one CX22** if traffic is small: Nginx fronts both with different `server_name`s, Postgres serves both databases. Split once either crosses ~50 req/s sustained.

**Bootstrap script** (`infra/deploy/bootstrap-cx22.sh`) — run once per fresh server:

```bash
#!/usr/bin/env bash
set -euo pipefail
apt update && apt -y full-upgrade
apt -y install nginx postgresql-16 redis-server fail2ban ufw unattended-upgrades \
               php8.3-fpm php8.3-pgsql php8.3-redis php8.3-mbstring php8.3-xml \
               php8.3-curl php8.3-zip php8.3-intl php8.3-gd composer
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs
npm i -g pm2
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
systemctl enable --now fail2ban
dpkg-reconfigure -plow unattended-upgrades
```

**SSL**: terminate at Cloudflare (Full-Strict). Issue an Origin Certificate from Cloudflare with a 15-year lifetime and install in Nginx. No Certbot. Cloudflare DNS proxies `app.example.ro` → CX22 public IP. The `set_real_ip_from` Cloudflare ranges block in Nginx is mandatory or access logs will only show `172.x` Cloudflare IPs.

**Hardening checklist** (codified in `bootstrap-cx22.sh`):
- Disable root SSH password login (`PermitRootLogin prohibit-password`)
- Create `deploy` user, key from `secrets.DEPLOY_SSH_KEY` only
- `fail2ban` with default `sshd` jail
- `unattended-upgrades` for security patches
- UFW: only 22 (rate-limited), 80, 443
- Postgres bound to `127.0.0.1` only

---

# PART 4 — Decision Framework

## When Laravel wins
- App is **forms / CRUD-heavy** (invoices, contracts, ANAF reports, contact mgmt). Filament 4 admin + Livewire customer side cuts weeks off the build.
- **Romanian/EU compliance is on the critical path.** Mature libraries exist: `pristavu/laravel-anaf` (last updated Mar 12 2026 per Packagist), `bee-coded/laravel-efactura-sdk` v1.1 (Mar 4 2026), `andalisolutions/anaf-php`. Node has no equivalent — you'd build the OAuth + UBL XML flow yourself. Note bee-coded's caveat: *"ANAF uses rotating refresh tokens. When a token is refreshed, both the access token AND refresh token are replaced. The old refresh token becomes invalid."*
- You want **Spatie packages**: `laravel-backup`, `laravel-permission`, `laravel-medialibrary`, `laravel-activitylog`.
- Team is **PHP-first** (solo Narcis) and AI tools (Claude Code, Cursor) have more Laravel training data than for any other backend framework.

## When AdonisJS wins
- App is **frontend-interactive** — drag-and-drop boards, Kanban, charts, anything with lots of client-side state. Inertia + Vue 3 beats Livewire here.
- You want **TypeScript end-to-end** with one mental model.
- App needs **realtime over SSE/WebSockets** — AdonisJS Transmit (first-party SSE) is simpler than Laravel Reverb.
- You don't need Filament-style admin scaffolding.
- App must run on the **smallest possible footprint** — AdonisJS apps idle around ~60 MB RSS vs PHP-FPM's ~150 MB per worker (Laravel's typical PHP-FPM pool sizing assumption; PM2 cluster mode for Node similarly maxes one process per core).

## Concrete decision matrix

| Dimension | Laravel | AdonisJS | Tiebreaker |
|---|---|---|---|
| Romanian e-Factura / ANAF | ✅ mature libs | ⚠️ DIY | **Laravel** if compliance |
| Admin panel needed | ✅ Filament 4 | ❌ build yourself | **Laravel** |
| Customer UI mostly forms | ✅ Livewire | ✅ Inertia/Vue | **Laravel** (faster) |
| Customer UI interactive | ⚠️ Livewire OK | ✅ Vue native | **AdonisJS** |
| Realtime SSE/WebSockets | ⚠️ Reverb | ✅ Transmit | **AdonisJS** |
| TypeScript-only team | ⚠️ | ✅ | **AdonisJS** |
| Background jobs / queues | ✅ Horizon | ⚠️ BullMQ DIY | **Laravel** |
| Spatie-style ecosystem | ✅ huge | ❌ small | **Laravel** |
| Memory footprint on CX22 | medium | low | **AdonisJS** for many small apps |
| AI tool training data | huge | smaller | **Laravel** for Claude/Cursor |
| First-party deploy tooling | Forge/Ploi/Cloud | none (Coolify) | **Laravel** |

**Default to Laravel.** Pick AdonisJS only when the app has a specific reason on the AdonisJS side that Laravel can't match.

---

# PART 5 — Step-by-Step Bootstrapping Checklist

### 1. Create the template repo
```bash
gh repo create boring-saas-template --private --clone
cd boring-saas-template
mkdir -p apps docs infra/{nginx,deploy,cloudflare} shared/{sql,fixtures} .github/workflows
echo "22" > .nvmrc
# (commit .editorconfig, .gitignore, LICENSE, Justfile, lefthook.yml, etc.)
```
On github.com → Settings → "Template repository" → enable.

### 2. Bootstrap the Laravel scaffold
Run the commands in §1a inside `apps/laravel-app/`. Then:
```bash
cd apps/laravel-app
php artisan make:migration create_social_accounts_table
php artisan make:migration add_password_nullable_to_users
php artisan make:migration create_tasks_table
php artisan make:model SocialAccount
php artisan make:model Task -fmpr
php artisan make:filament-resource Task --generate
php artisan make:controller Auth/SocialLoginController
php artisan migrate
./vendor/bin/pest tests/Feature/TasksCrudTest.php
git add -A && git commit -m "feat(laravel): tasks crud + google oauth linking"
```

### 3. Bootstrap the AdonisJS scaffold
Run §2a, then:
```bash
cd apps/adonis-app
node ace make:model SocialAccount -m
node ace make:model Task -m
node ace make:controller tasks --resource
node ace make:controller auth/social
node ace make:policy task
node ace make:validator task
node ace migration:run
node ace test
git add -A && git commit -m "feat(adonis): tasks crud + google oauth linking"
```

### 4. Wire Google OAuth (one Google project, four redirect URIs)
In Google Cloud Console → Credentials → OAuth Client ID (Web App):
- `http://localhost:8000/auth/google/callback` (Laravel dev)
- `http://localhost:3333/auth/google/callback` (AdonisJS dev)
- `https://app.example.ro/auth/google/callback` (Laravel prod)
- `https://app2.example.ro/auth/google/callback` (AdonisJS prod)

Copy `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` to both `.env`s.

### 5. Docker Compose
```bash
just db-up
psql postgresql://saas:saas@127.0.0.1:5432/saas -f shared/sql/seed-tasks.sql
```

### 6. GitHub Actions secrets
Settings → Secrets:
- `LARAVEL_HOST`, `ADONIS_HOST` (Hetzner IPs)
- `PLOI_SSH_KEY`, `DEPLOY_SSH_KEY`
- `SENTRY_DSN_LARAVEL`, `SENTRY_DSN_ADONIS`

### 7. First deploy to Hetzner
```bash
hcloud server create --type cx22 --location fsn1 --image ubuntu-24.04 --name saas-prod
ssh root@<ip> bash < infra/deploy/bootstrap-cx22.sh

# Laravel: Ploi → add server (paste IP) → installs → add site → enable repo deploy
# AdonisJS:
gh workflow run deploy.yml --field app=adonis

# DNS: Cloudflare add A record app.example.ro → <ip>, orange-cloud on
# SSL: Cloudflare → SSL/TLS → Full (Strict). Generate Origin Cert, install in Nginx.
```

### 8. Starting a new project from the template
```bash
gh repo create acme-crm --template=narcis/boring-saas-template --private --clone
cd acme-crm
just init laravel        # OR: just init adonis
sed -i 's/boring-saas/acme-crm/g' .env.example composer.json README.md
git commit -am "chore: bootstrap acme-crm from template"
```

`just init` rule:
```makefile
init flavor:
    @if [ "{{flavor}}" = "laravel" ]; then rm -rf apps/adonis-app docs/20-adonis.md; fi
    @if [ "{{flavor}}" = "adonis" ];  then rm -rf apps/laravel-app docs/10-laravel.md; fi
```

---

## Observability baseline (both scaffolds)

- **Request logging**: Laravel → `storage/logs/laravel.log` daily rotation (view in dev via opcodesio/log-viewer); AdonisJS → pino JSON to stdout, PM2 captures it. Forward both to a central destination (BetterStack/Axiom) once you have paying customers.
- **Error reporting**: Sentry installed in both, DSN in `.env`. Default: report only `>= warning` in production.
- **Health endpoint**: `/up` (Laravel built-in) and `/health` (Adonis custom). Cloudflare Health Checks poll once a minute.

---

## Recommendations (prioritised)

1. **Build the template now with Laravel as the default scaffold and AdonisJS as the alternative.** ~85% of B2B SaaS for the EU/RO market falls into "Laravel wins" territory; AdonisJS is the exception.
2. **Pin every dependency to a known-good version** (see §0). Don't `composer require laravel/framework` — `composer require laravel/framework:^12.0`. AI tools regress when given unpinned majors.
3. **Day-1 ops budget per Laravel project: €8/mo Ploi Basic + ~€4/mo CX22 + Cloudflare free = ~€12/mo.** AdonisJS-only projects drop to ~€4/mo by using GitHub Actions + SSH instead of Ploi.
4. **Switch to Coolify on a second CX22 only at 4+ live projects**, not before — Ploi's per-server model gets expensive at scale; the devtoolpicks 2026 review puts the Coolify break-even at saving ~$228/year vs Forge Growth.
5. **Threshold to add Redis + Horizon (Laravel) or BullMQ (Adonis):** when scheduled jobs cross ~10k/day, any sync request takes >300ms, or you need delayed jobs. Until then, `database` queue is sufficient.
6. **Threshold to migrate to AdonisJS v7 / Filament v5 / Livewire v4:** wait 6 months after stable release for plugin ecosystems and AI training data to catch up. Filament v5 stable + AdonisJS v7 stable both arrived in early 2026, so plan evaluation for ~Sep 2026.
7. **Add a `staging` environment on the same CX22** (subdomain + separate DB) once the first SaaS has paying customers. Cost is zero extra; the Ploi Basic plan already covers up to 5 servers.

---

## Caveats and known sharp edges

1. **AdonisJS v7 shipped Feb 25 2026** ("It's finally here. AdonisJS v7 is out. This is an incremental upgrade to v6 with minimal breaking changes" — Harminder Virk, adonisjs.com/blog/v7). This template uses v6 syntax; upgrading is a separate task (Inertia adapter has a v7-only rework with type-safe `pages.d.ts`). Don't mix v6 and v7 packages.
2. **Filament v5 (Livewire 4) is also stable** as of late 2025. Stay on Filament v4 / Livewire 3 in this template because v3's plugin ecosystem is still richer and AI tools have more training data on it. Migrate per-project later.
3. **WorkOS AuthKit starter kit** is an alternative bundling passkeys + SSO; skip it for the template default. It's a per-app decision that adds a WorkOS dependency.
4. **Native Postgres enums** are deliberately avoided — Laravel migrations can't `ALTER TYPE` them cleanly. String columns + PHP/TS enum casts give the same DX with none of the migration pain.
5. The `pristavu/laravel-anaf` package handles ANAF + e-Factura cleanly but be aware ANAF rotates refresh tokens — store both tokens server-side and update both on every refresh (the bee-coded SDK documents this explicitly).
6. The template's `social_accounts` table stores only `provider_id` and `provider_email` — **not** the access token. If a future project needs to call Google APIs on the user's behalf (Calendar, Drive), add an encrypted `access_token` / `refresh_token` column at that time.
7. **Mailpit is dev-only.** Production should use Postmark or Resend; Romania-bound transactional email from a raw Hetzner IP often hits blocklists, so don't self-host SMTP.
8. The TechvBlogs OAuth callback snippet (and Laravel's own docs example) doesn't check the verified-email flag; both scaffolds in this template **must** gate the email-link branch on the provider's `email_verified` / `emailVerificationState`. Without that check, an attacker who registers an unverified Google account with somebody else's email could take over the existing user.
9. **Hetzner's April 1, 2026 price adjustment** raised CX22 above its original €3.79/month launch price. The latest community reference (devtoolpicks 2026) puts it at "roughly €4/month" — budget around that.
10. **Branch protection + paths-filter** require the `required` aggregator job in `ci.yml`; otherwise GitHub treats a skipped conditional job as "not run" and blocks merges (GitHub community discussion #26251).
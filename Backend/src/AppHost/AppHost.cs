// QA Studio development orchestrator (Aspire). One command starts the whole system, with hot reload, and opens the
// dashboard with every process's logs, traces and metrics:
//
//     dotnet run --project Backend/src/AppHost
//
// It describes the same processes as Worker/scripts/start.mjs, which remains the way an install starts. Options live in
// appsettings.json beside this file (section "QaStudio"). See docs/adr/0012-aspire-for-development-and-observability.md.
using Microsoft.Extensions.Configuration;

var builder = DistributedApplication.CreateBuilder(args);
var options = builder.Configuration.GetSection("QaStudio");

var apiPort = options.GetValue("ApiPort", 5080);
var workerPort = options.GetValue("WorkerPort", 4000);
var frontendPort = options.GetValue("FrontendPort", 5173);
var hotReload = options.GetValue("HotReload", true);
// Visual Studio / VS Code launch the AppHost with a debug session and then run project resources themselves, with
// their own debugger and hot reload. Only from the command line do we need "dotnet watch" for the API.
var launchedByIde = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DEBUG_SESSION_PORT"));

// 127.0.0.1, not "localhost": Node resolves localhost to ::1 first, and the API and worker only listen on IPv4 loopback.
var apiUrl = $"http://127.0.0.1:{apiPort}";
var workerUrl = $"http://127.0.0.1:{workerPort}";

var backendDirectory = Path.GetFullPath(Path.Combine(builder.AppHostDirectory, "..", ".."));
var apiProjectDirectory = Path.Combine(backendDirectory, "src", "API");
var workerDirectory = Path.Combine(backendDirectory, "Worker");
var frontendDirectory = Path.GetFullPath(Path.Combine(backendDirectory, "..", "Frontend"));

// The API and worker authenticate each other's internal calls with this token. It is generated once and kept in the
// AppHost's user secrets, and both processes get it from here, so they can never disagree (start.mjs does the same by hand).
var internalToken = builder.AddParameter(
    "internal-token",
    new GenerateParameterDefault { MinLength = 32, Special = false },
    secret: true,
    persist: true);

// ---- .NET API --------------------------------------------------------------------------------------------------------
// Hot reload from the command line: "dotnet watch" applies supported edits in place and restarts on the rest
// (DOTNET_WATCH_RESTART_ON_RUDE_EDIT). Note it builds into src/API/bin/Debug, which Visual Studio locks while it runs the API.
IResourceBuilder<IResource> api = hotReload && !launchedByIde
    ? ConfigureApi(builder.AddExecutable(
            "api", "dotnet", apiProjectDirectory, "watch", "--project", "QaStudio.Api.csproj", "--non-interactive", "--no-launch-profile")
        .WithEnvironment("DOTNET_WATCH_RESTART_ON_RUDE_EDIT", "true")
        .WithOtlpExporter())
    : ConfigureApi(builder.AddProject<Projects.QaStudio_Api>("api", launchProfileName: null));

// ---- Node worker -----------------------------------------------------------------------------------------------------
// The worker runs compiled JavaScript, so compile it first (tsc -b is incremental: a no-op when nothing changed).
// Node is called directly rather than through npm, so stopping the AppHost stops the real process, not a shell wrapper.
var workerBuild = builder.AddExecutable("worker-build", "node", workerDirectory, "node_modules/typescript/bin/tsc", "-b");

// Hot reload: tsc keeps recompiling changed packages, and "node --watch" restarts the worker when its output changes.
// A restart closes queued and running test runs as cancelled (as after any restart), so expect that while editing.
if (hotReload)
{
    builder.AddExecutable(
            "worker-watch", "node", workerDirectory, "node_modules/typescript/bin/tsc", "-b", "--watch", "--preserveWatchOutput")
        .WaitForCompletion(workerBuild);
}

var worker = ConfigureNode(
        hotReload
            ? builder.AddExecutable("worker", "node", workerDirectory, NodeArgs("services/qa-api/dist/server.js")).WithOtlpExporter()
            : builder.AddNodeApp("worker", workerDirectory, "services/qa-api/dist/server.js").WithNpm(install: false))
    .WithHttpEndpoint(port: workerPort, env: "PORT", isProxied: false)
    .WithEnvironment("HOST", "127.0.0.1")
    .WithEnvironment("QA_PERSISTENCE_URL", apiUrl)
    .WithEnvironment("QA_INTERNAL_TOKEN", internalToken)
    .WithHttpHealthCheck("/api/health")
    // The worker saves its starting configuration through the API at start-up, so the API must be answering first.
    .WaitFor(api);

// ---- Voice agent (optional, as in start.mjs: it needs LiveKit settings in Backend/Worker/.env) --------------------------
if (options.GetValue("Voice", false))
{
    ConfigureNode(
            hotReload
                ? builder.AddExecutable("voice", "node", workerDirectory, NodeArgs("services/qa-voice/dist/server.js", "start")).WithOtlpExporter()
                : builder.AddNodeApp("voice", workerDirectory, "services/qa-voice/dist/server.js").WithNpm(install: false).WithArgs("start"))
        .WaitFor(worker);
}

// ---- Frontend ----------------------------------------------------------------------------------------------------------
// The Vite dev server: hot module replacement in the browser, and /api proxied to the API exactly as when started by hand.
if (options.GetValue("Frontend", true))
{
    builder.AddJavaScriptApp("frontend", frontendDirectory, "dev")
        // Never run "npm install" on start: it could rewrite package-lock.json. Dependencies are installed with npm ci.
        .WithNpm(install: false)
        .WithHttpEndpoint(port: frontendPort, env: "PORT", isProxied: false)
        .WithEnvironment("QA_API_URL", apiUrl)
        // Wait for the worker, not only the API: many pages call worker routes on load, and before the worker answers
        // the gateway replies 503 "worker-unavailable". The worker itself waits for the API, so this covers both.
        .WaitFor(worker);
}

await builder.Build().RunAsync().ConfigureAwait(false);

// "Urls" (not only ASPNETCORE_URLS) because Backend/appsettings.json sets Urls and is loaded after the host variables;
// plain environment variables are loaded last and win.
IResourceBuilder<IResource> ConfigureApi<T>(IResourceBuilder<T> resource)
    where T : IResourceWithEnvironment, IResourceWithEndpoints, IResourceWithWaitSupport
{
    resource
        .WithHttpEndpoint(port: apiPort, isProxied: false)
        .WithEnvironment("ASPNETCORE_ENVIRONMENT", "Development")
        .WithEnvironment("Urls", apiUrl)
        .WithEnvironment("Worker__BaseUrl", workerUrl)
        .WithEnvironment("Worker__InternalToken", internalToken)
        // Visual Studio injects its Endpoints Explorer helper (a hosting startup assembly) into the API it debugs. Launched
        // through the AppHost, VS cannot supply the file, so every start logged a Critical "Hosting startup assembly exception".
        // Exclude just that one; other hosting startups (such as dotnet watch's) still load.
        .WithEnvironment("ASPNETCORE_HOSTINGSTARTUPEXCLUDEASSEMBLIES", "Microsoft.WebTools.ApiEndpointDiscovery")
        .WithHttpHealthCheck("/api/health");

    // Database, in order of preference:
    //  1. QaStudio:SqlContainer=true: a throw-away SQL Server container (needs Docker), migrated on start.
    //  2. ConnectionStrings:QaStudio set for the AppHost (user secrets or environment): passed to the API, e.g. a scratch database.
    //  3. Neither: the API uses the connection string in Backend/appsettings.json (your local SQL Server). No Docker needed.
    if (options.GetValue("SqlContainer", false))
    {
        var database = builder.AddSqlServer("sql")
            .WithDataVolume("qa-studio-sql-data")
            .AddDatabase("QaStudio");
        resource.WithReference(database)
            .WaitFor(database)
            .WithEnvironment("Database__ApplyMigrationsOnStartup", "true");
    }
    else if (!string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString("QaStudio")))
    {
        resource.WithReference(builder.AddConnectionString("QaStudio"));
    }

    return (IResourceBuilder<IResource>)resource;
}

// Every Node process waits for the first compile, so it never starts on missing or stale JavaScript.
IResourceBuilder<T> ConfigureNode<T>(IResourceBuilder<T> resource)
    where T : IResourceWithWaitSupport =>
    resource.WaitForCompletion(workerBuild);

// "node --watch" restarts the process when any module it loaded changes (the tsc output of every worker package).
static string[] NodeArgs(string script, params string[] scriptArgs) =>
    ["--watch", "--watch-preserve-output", script, .. scriptArgs];

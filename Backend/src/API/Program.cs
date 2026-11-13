using QaStudio.Api.Common;
using QaStudio.Api.Gateway;
using QaStudio.Api.Security;
using QaStudio.Application;
using QaStudio.Application.Common;
using QaStudio.Infrastructure;
using QaStudio.ServiceDefaults;

var builder = WebApplication.CreateBuilder(args);

// Settings live at Backend/ and are copied beside the binaries. Environment variables still win over them.
builder.Configuration
    .AddJsonFile(Path.Combine(AppContext.BaseDirectory, "appsettings.json"), optional: false, reloadOnChange: false)
    .AddJsonFile(Path.Combine(AppContext.BaseDirectory, $"appsettings.{builder.Environment.EnvironmentName}.json"), optional: true, reloadOnChange: false)
    .AddEnvironmentVariables();

// OpenTelemetry, only when the Aspire AppHost (or an operator) configures an OTLP endpoint; otherwise a no-op.
builder.AddServiceDefaults();

builder.Services
    .AddApplication()
    .Configure<LimitsOptions>(builder.Configuration.GetSection(LimitsOptions.Section))
    .AddInfrastructure(builder.Configuration)
    .AddApiCommon()
    .AddApiSecurity(builder.Configuration)
    .AddWorkerGateway();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.CustomSchemaIds(type => type.FullName?.Replace('+', '.'));
    foreach (var assembly in new[] { typeof(Program).Assembly, typeof(QaStudio.Application.DependencyInjection).Assembly })
    {
        var xml = Path.Combine(AppContext.BaseDirectory, $"{assembly.GetName().Name}.xml");
        if (File.Exists(xml))
        {
            options.IncludeXmlComments(xml);
        }
    }
});

var app = builder.Build();

app.UseExceptionHandler();
app.UseApiSecurity();
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseFrontend();
app.MapApiEndpoints();
app.MapWorkerGateway();
app.MapFrontendFallback();

await app.MigrateDatabaseIfConfiguredAsync().ConfigureAwait(false);
await app.RunAsync().ConfigureAwait(false);

/// <summary>The application entry point; public so integration tests can host it.</summary>
public partial class Program
{
    /// <summary>Only the compiler's top-level statements and test hosts deal with this type.</summary>
    protected Program()
    {
    }
}


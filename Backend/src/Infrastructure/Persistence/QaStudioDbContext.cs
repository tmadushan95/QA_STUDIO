using Microsoft.EntityFrameworkCore;
using QaStudio.Core.Automation;
using QaStudio.Core.MasterData;
using QaStudio.Core.TestCases;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>The QA Studio database.</summary>
/// <param name="options">Connection options.</param>
public sealed class QaStudioDbContext(DbContextOptions<QaStudioDbContext> options) : DbContext(options)
{
    /// <summary>Parameter values test cases set for themselves.</summary>
    public DbSet<CaseParameterValue> CaseParameterValues => Set<CaseParameterValue>();

    /// <summary>Parameter values shared by a project's cases.</summary>
    public DbSet<ProjectParameterValue> ProjectParameterValues => Set<ProjectParameterValue>();

    /// <summary>Projects.</summary>
    public DbSet<Project> Projects => Set<Project>();

    /// <summary>Test suites.</summary>
    public DbSet<TestSuite> TestSuites => Set<TestSuite>();

    /// <summary>Project versions (releases).</summary>
    public DbSet<ProjectVersion> ProjectVersions => Set<ProjectVersion>();

    /// <summary>Test cases.</summary>
    public DbSet<TestCase> TestCases => Set<TestCase>();

    /// <summary>Written test steps.</summary>
    public DbSet<TestCaseStep> TestCaseSteps => Set<TestCaseStep>();

    /// <summary>Live scenario records.</summary>
    public DbSet<ScenarioRecord> ScenarioRecords => Set<ScenarioRecord>();

    /// <summary>Earlier scenario versions.</summary>
    public DbSet<ScenarioRevision> ScenarioRevisions => Set<ScenarioRevision>();

    /// <summary>Test runs.</summary>
    public DbSet<TestRun> TestRuns => Set<TestRun>();

    /// <summary>Configuration blocks.</summary>
    public DbSet<ConfigEntry> ConfigEntries => Set<ConfigEntry>();

    /// <summary>Test accounts.</summary>
    public DbSet<TestAccount> TestAccounts => Set<TestAccount>();

    /// <summary>Saved browser sessions.</summary>
    public DbSet<AccountSession> AccountSessions => Set<AccountSession>();

    /// <summary>AI provider keys.</summary>
    public DbSet<AiProviderKey> AiProviderKeys => Set<AiProviderKey>();

    /// <summary>Audit trail.</summary>
    public DbSet<AuditEntry> AuditLog => Set<AuditEntry>();

    /// <summary>Snapshots taken before clearing data.</summary>
    public DbSet<DataBackup> DataBackups => Set<DataBackup>();

    /// <inheritdoc />
    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(QaStudioDbContext).Assembly);
}


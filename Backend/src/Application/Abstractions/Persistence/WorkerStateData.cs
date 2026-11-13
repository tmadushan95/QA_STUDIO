using QaStudio.Core.Automation;

namespace QaStudio.Application.Abstractions;

/// <summary>Everything the worker loads at start-up, as stored.</summary>
public sealed record WorkerStateData
{
    /// <summary>Live scenario records.</summary>
    public required IReadOnlyList<ScenarioRecord> Scenarios { get; init; }

    /// <summary>Earlier versions.</summary>
    public required IReadOnlyList<ScenarioRevision> Revisions { get; init; }

    /// <summary>Newest runs, oldest first.</summary>
    public required IReadOnlyList<TestRun> Runs { get; init; }

    /// <summary>Configuration blocks.</summary>
    public required IReadOnlyList<ConfigEntry> Config { get; init; }

    /// <summary>Test accounts.</summary>
    public required IReadOnlyList<TestAccount> Accounts { get; init; }

    /// <summary>Saved browser sessions.</summary>
    public required IReadOnlyList<AccountSession> Sessions { get; init; }

    /// <summary>AI provider keys.</summary>
    public required IReadOnlyList<AiProviderKey> AiKeys { get; init; }

    /// <summary>Backups.</summary>
    public required IReadOnlyList<DataBackup> Backups { get; init; }
}

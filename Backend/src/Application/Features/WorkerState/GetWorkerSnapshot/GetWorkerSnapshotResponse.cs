using System.Text.Json;
using QaStudio.Application.Features.TestCases.Common;
using QaStudio.Core.Automation;

namespace QaStudio.Application.Features.WorkerState.GetWorkerSnapshot;

/// <summary>A scenario record slot and document.</summary>
/// <param name="Slot">Draft or approved.</param>
/// <param name="CaseId">The case ID.</param>
/// <param name="Record">The document.</param>
public sealed record SnapshotScenario(string Slot, string CaseId, JsonElement Record);

/// <summary>A scenario revision.</summary>
/// <param name="CaseId">The case ID.</param>
/// <param name="Version">Version number.</param>
/// <param name="Record">The document.</param>
public sealed record SnapshotRevision(string CaseId, int Version, JsonElement Record);

/// <summary>Everything the worker loads at start-up. Its property names are what the worker's storage reads.</summary>
public sealed record GetWorkerSnapshotResponse
{
    /// <summary>Every test case.</summary>
    public required IReadOnlyList<TestCaseResponse> TestCases { get; init; }

    /// <summary>Live scenario records.</summary>
    public required IReadOnlyList<SnapshotScenario> Scenarios { get; init; }

    /// <summary>Earlier versions.</summary>
    public required IReadOnlyList<SnapshotRevision> Revisions { get; init; }

    /// <summary>Newest runs, oldest first.</summary>
    public required IReadOnlyList<JsonElement> Runs { get; init; }

    /// <summary>Configuration blocks by name.</summary>
    public required IReadOnlyDictionary<string, JsonElement> Config { get; init; }

    /// <summary>Test accounts, ciphertext only.</summary>
    public required IReadOnlyList<TestAccount> Accounts { get; init; }

    /// <summary>Saved browser sessions, ciphertext only.</summary>
    public required IReadOnlyList<AccountSession> Sessions { get; init; }

    /// <summary>AI provider keys, ciphertext only.</summary>
    public required IReadOnlyList<AiProviderKey> AiKeys { get; init; }

    /// <summary>Backups.</summary>
    public required IReadOnlyList<JsonElement> Backups { get; init; }
}

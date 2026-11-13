using QaStudio.Core.Common;

namespace QaStudio.Core.Automation;

/// <summary>One test run, with its per-case results as a JSON document.</summary>
public sealed class TestRun
{
    private TestRun()
    {
    }

    /// <summary>Run ID.</summary>
    public string Id { get; private set; } = string.Empty;

    /// <summary>When the run was created (UTC). The natural partitioning key for long histories.</summary>
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Run status, surfaced for reporting without parsing the JSON.</summary>
    public string Status { get; private set; } = string.Empty;

    /// <summary>The full run as JSON.</summary>
    public string Json { get; private set; } = "{}";

    /// <summary>Creates a run.</summary>
    /// <param name="id">Run ID.</param>
    /// <param name="createdAtUtc">When it was created.</param>
    /// <param name="status">Run status.</param>
    /// <param name="json">The full run.</param>
    /// <returns>The run.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static TestRun Create(string id, DateTime createdAtUtc, string status, string json)
    {
        new DomainRules()
            .Required(FieldNames.Id, id, "A run needs an ID.")
            .MaxLength(FieldNames.Id, id, DocumentLimits.IdMaxLength)
            .MaxLength(FieldNames.Status, status, DocumentLimits.StatusMaxLength)
            .Required(FieldNames.Json, json, "A run needs a document.")
            .ThrowIfBroken();
        return new TestRun { Id = id, CreatedAtUtc = createdAtUtc, Status = status, Json = json };
    }

    /// <summary>Takes on the latest state of the same run.</summary>
    /// <param name="newer">The latest state.</param>
    public void ReplaceWith(TestRun newer)
    {
        ArgumentNullException.ThrowIfNull(newer);
        CreatedAtUtc = newer.CreatedAtUtc;
        Status = newer.Status;
        Json = newer.Json;
    }
}

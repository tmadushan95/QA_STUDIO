using System.ComponentModel.DataAnnotations;

namespace QaStudio.Application.Common;

/// <summary>How much one request may ask for, from the <c>Limits</c> configuration section. Column sizes are the domain's.</summary>
public sealed class LimitsOptions
{
    /// <summary>The configuration section name.</summary>
    public const string Section = "Limits";

    /// <summary>The most test cases on one page.</summary>
    [Range(1, 1000)]
    public int MaxPageSize { get; set; } = 200;

    /// <summary>The most written steps a form may send for one test case.</summary>
    [Range(1, 10000)]
    public int MaxStepsPerCase { get; set; } = 200;

    /// <summary>The longest written step a form may send.</summary>
    [Range(1, 100000)]
    public int MaxStepLength { get; set; } = 4000;

    /// <summary>The most test cases one delete or move may name.</summary>
    [Range(1, 100000)]
    public int MaxCasesPerRequest { get; set; } = 5000;

    /// <summary>The most worker writes in one transaction.</summary>
    [Range(1, 100000)]
    public int MaxWorkerBatch { get; set; } = 1000;

    /// <summary>How many of the newest runs the worker loads when it starts.</summary>
    [Range(1, 10000)]
    public int SnapshotRuns { get; set; } = 100;

    /// <summary>The most audit entries one request may read.</summary>
    [Range(1, 100000)]
    public int MaxAuditEntries { get; set; } = 500;
}

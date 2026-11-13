using System.ComponentModel.DataAnnotations;

namespace QaStudio.Infrastructure;

/// <summary>SQL Server settings, from the <c>Database</c> configuration section.</summary>
public sealed class DatabaseOptions
{
    /// <summary>The configuration section name.</summary>
    public const string Section = "Database";

    /// <summary>Seconds before a command is abandoned.</summary>
    [Range(1, 600)]
    public int CommandTimeoutSeconds { get; set; } = 30;

    /// <summary>How many times a transient SQL failure is retried.</summary>
    [Range(0, 10)]
    public int MaxRetryCount { get; set; } = 3;

    /// <summary>Apply pending migrations when the API starts.</summary>
    public bool ApplyMigrationsOnStartup { get; set; }

    /// <summary>Minutes master data may be served from memory before being re-read.</summary>
    [Range(1, 1440)]
    public int MasterDataCacheMinutes { get; set; } = 10;
}

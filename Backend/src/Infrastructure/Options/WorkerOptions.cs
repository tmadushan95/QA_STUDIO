namespace QaStudio.Infrastructure;

/// <summary>How to reach the execution worker, from the <c>Worker</c> configuration section.</summary>
public sealed class WorkerOptions
{
    /// <summary>The configuration section name.</summary>
    public const string Section = "Worker";

    /// <summary>The worker's base address.</summary>
    public Uri BaseUrl { get; set; } = new("http://127.0.0.1:4000");

    /// <summary>The secret both sides send on internal calls. Must come from local settings or the environment.</summary>
    public string InternalToken { get; set; } = string.Empty;
}

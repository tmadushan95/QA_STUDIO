namespace QaStudio.Application.Abstractions;

/// <summary>The current time, injectable so tests are deterministic.</summary>
public interface IClock
{
    /// <summary>The current UTC time.</summary>
    DateTime UtcNow { get; }
}

namespace QaStudio.Application.Common;

/// <summary>The result of a command with nothing to report, such as a delete.</summary>
public readonly record struct Unit
{
    /// <summary>The only value.</summary>
    public static readonly Unit Value;
}

namespace QaStudio.Core.Automation;

/// <summary>Limits of parameter values, the same as when they were kept in one JSON block.</summary>
public static class ParameterLimits
{
    /// <summary>The longest parameter name.</summary>
    public const int NameMaxLength = 100;

    /// <summary>The longest value.</summary>
    public const int ValueMaxLength = 500;

    /// <summary>The most names one case may hold.</summary>
    public const int MaxPerCase = 200;
}

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Column conventions shared by the table configurations.</summary>
internal static class SqlConventions
{
    /// <summary>
    /// Case-sensitive collation for IDs the worker treats as exact strings. Under the server's default collation
    /// <c>tc_01</c> and <c>TC_01</c> would collide here while being two different cases in the worker.
    /// </summary>
    public const string ExactMatch = "Latin1_General_100_BIN2";

    /// <summary>Fixed creation time of seeded rows; migrations must be deterministic.</summary>
    public static readonly DateTime SeedTime = new(2026, 11, 2, 0, 0, 0, DateTimeKind.Utc);

    /// <summary>Adds a constraint that the column holds a valid JSON object or array.</summary>
    /// <typeparam name="T">The entity.</typeparam>
    /// <param name="builder">The table builder.</param>
    /// <param name="table">The table's name.</param>
    /// <param name="column">The column.</param>
    public static void RequireJson<T>(EntityTypeBuilder<T> builder, string table, string column = "Json")
        where T : class =>
        builder.ToTable(table, t => t.HasCheckConstraint($"CK_{table}_{column}_IsJson", $"ISJSON([{column}]) = 1"));
}

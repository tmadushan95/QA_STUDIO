using QaStudio.Application.Abstractions;
using QaStudio.Core.Common;

namespace QaStudio.Application.Common;

/// <summary>Converts concurrency tokens between their API form (base64) and bytes.</summary>
internal static class RowVersions
{
    /// <summary>Encodes a token.</summary>
    /// <param name="value">The bytes.</param>
    /// <returns>Base64.</returns>
    public static string Encode(byte[] value) => Convert.ToBase64String(value);

    /// <summary>Decodes a token from a request.</summary>
    /// <param name="value">Base64.</param>
    /// <returns>The bytes.</returns>
    /// <exception cref="RequestValidationException">The value is not base64.</exception>
    public static byte[] Decode(string value)
    {
        try
        {
            return Convert.FromBase64String(value);
        }
        catch (FormatException)
        {
            throw new RequestValidationException(ErrorCodes.InvalidRequest, "The row version is not valid.");
        }
    }

    /// <summary>Makes a save fail if the row changed after the editor opened it. A caller may leave the version out.</summary>
    /// <typeparam name="TEntity">The entity.</typeparam>
    /// <param name="repository">Its repository.</param>
    /// <param name="entity">The tracked entity.</param>
    /// <param name="rowVersion">The version the editor opened, if sent.</param>
    public static void ExpectVersionIfGiven<TEntity>(this IRepository<TEntity> repository, TEntity entity, string? rowVersion)
        where TEntity : class
    {
        if (rowVersion is not null)
        {
            repository.ExpectVersion(entity, Decode(rowVersion));
        }
    }
}

using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace QaStudio.Api.Security;

/// <summary>Sign-in sessions and attempt limiting, held in memory: a restart simply asks for the token again.</summary>
/// <param name="options">Security settings.</param>
/// <param name="time">The clock.</param>
public sealed class SessionStore(IOptions<SecurityOptions> options, TimeProvider time)
{
    /// <summary>How long a session lasts.</summary>
    public static readonly TimeSpan SessionLifetime = TimeSpan.FromHours(12);

    private const int MaxAttemptsPerMinute = 5;
    private readonly ConcurrentDictionary<string, DateTimeOffset> _sessions = new(StringComparer.Ordinal);
    private readonly Lock _attemptsLock = new();
    private readonly List<DateTimeOffset> _attempts = [];

    /// <summary>Whether a token is configured at all.</summary>
    public bool TokenRequired => !string.IsNullOrEmpty(options.Value.AdminToken);

    /// <summary>Compares a token in constant time.</summary>
    /// <param name="token">The token given.</param>
    /// <returns>True if it matches.</returns>
    public bool TokenMatches(string token) =>
        TokenRequired && CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(token)),
            SHA256.HashData(Encoding.UTF8.GetBytes(options.Value.AdminToken!)));

    /// <summary>Counts a sign-in attempt, limiting guesses.</summary>
    /// <returns>False if too many were made in the last minute.</returns>
    public bool TryCountAttempt()
    {
        var now = time.GetUtcNow();
        lock (_attemptsLock)
        {
            _attempts.RemoveAll(at => now - at >= TimeSpan.FromMinutes(1));
            if (_attempts.Count >= MaxAttemptsPerMinute)
            {
                return false;
            }

            _attempts.Add(now);
            return true;
        }
    }

    /// <summary>Starts a session.</summary>
    /// <returns>Its ID.</returns>
    public string Start()
    {
        var id = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        _sessions[id] = time.GetUtcNow() + SessionLifetime;
        return id;
    }

    /// <summary>Ends a session.</summary>
    /// <param name="id">Its ID.</param>
    public void End(string id) => _sessions.TryRemove(id, out _);

    /// <summary>Whether a session is live.</summary>
    /// <param name="id">Its ID.</param>
    /// <returns>True if it is.</returns>
    public bool IsLive(string id)
    {
        if (!_sessions.TryGetValue(id, out var expires))
        {
            return false;
        }

        if (expires > time.GetUtcNow())
        {
            return true;
        }

        _sessions.TryRemove(id, out _);
        return false;
    }
}
